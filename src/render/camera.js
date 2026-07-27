/**
 * Two cameras over the same rig. Both look down the line with the face filling the left of
 * the frame — the view you actually get standing on a right-hander, rather than the
 * from-the-beach view every other surf game uses.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { TUNE } from '../tuning.js';
import { clamp, clamp01, approach, smoothstep } from '../rng.js';

export const CAM = { CHASE: 0, POV: 1 };

/* ---------------------------------------------------------------- mouth mount
 * The POV is a GoPro on a mouth mount, not a floating eye. It rides on the rider's HEAD, so
 * it walks the deck as they trim their stance and it drops when they compress — otherwise
 * the head walks out in front of a board-mounted camera and you end up looking at the back
 * of your own skull.
 *
 * Everything that PLACES it is live in TUNE — camEye, camAhead, camPitch, camWall, camDuck,
 * camLean — so it can be dragged in the tuner rather than recompiled. camPitch is the one
 * that matters most: the nose of a 2.3 m board sits ~44 deg below horizontal from the mouth
 * and the vertical half-FOV is only 30-35 deg, so without a good few degrees of tilt the
 * board falls off the bottom of the frame entirely. Buying more board costs you the wall —
 * past ~0.40 the lip of a section down the line starts clipping off the top.
 */
export const POV_AIM = 14;  // how far down the track the head is looking. Not a feel knob —
                            // it is the lever pitch and wall bias are measured against, which
                            // is why the tuner needs it to label them in degrees.

/* ------------------------------------------------------------------ head lead
 * A rider does not stare at the nose of their board through a turn — they look THROUGH it,
 * and the board comes round to meet where they are already looking. Feeding a slice of the
 * turn rate into the view direction (and NOT into the rig position) separates the head from
 * the body, so the board visibly trails through a bottom turn, snap or cutback. That trail
 * is what reads as a turn, rather than as the whole world rotating around a fixed board.
 *
 * Careful with TUNE.camLead: the yaw ease below is a first-order lag, so through a sustained
 * turn it already sits turnRate/yawK BEHIND the board. The lead has to pay that back before
 * any of it shows, which makes the effective look-ahead (camLead - 1/yawK) * turnRate — so
 * anything at or under ~0.20 does nothing at all.
 */
const LEAD_CLAMP = 2.2;   // rad/s past which the look-ahead stops growing
const LEAD_K = 7;         // the neck — quicker than the body, so it leads the turn
const CHASE_LEAD = 0.82;  // a rig behind you swivels less than a neck does...
const CHASE_WALL = 0.54;  // ...and needs less bias to keep the wall in frame
const YAW_K = [4.4, 5.0]; // [chase, pov] follow rate — damped, no snap

/* --------------------------------------------------------------- bottom turn
 * Down in the trough swinging back up at the wave, a rider is not looking where the board
 * points — they are looking up and across at the lip they are about to hit. Off the top they
 * are looking back down the face, which is what the ordinary trim framing already does.
 *
 * Detected from height plus turn direction, so it works either way round: you only read as
 * being in a bottom turn when you are LOW and actually swinging toward the lip. Trimming sits
 * at turnRate ~ 0, so BOT_RATE gates it off no matter how low you are.
 */
const BOT_U_LO = 0.10;    // fully "low" at or under this height on the face...
const BOT_U_HI = 0.45;    // ...and not low at all above this
const BOT_RATE = 1.2;     // rad/s of up-the-face swing that counts as fully committed
const BOT_K = 6;          // eased, so the lip focus swings in rather than snapping on

/* ---------------------------------------------------------------- snap whip
 * Without these the snap look-ahead is invisible, and the arithmetic is worth spelling out.
 *
 * The lead term is CLAMPED (LEAD_CLAMP), so it saturates at camLead*2.2 ~ 97 deg. The yaw
 * ease's own lag is NOT clamped — tracking a ramp at rate w it sits w/YAW_K behind. So:
 *
 *      w = 2.2 (a hard carve)  ->  97 - 25 = 72 deg of net look-ahead
 *      w = 8   (a snap)        ->  97 - 92 =  5 deg
 *
 * i.e. the faster you rotate the LESS the head leads, which is exactly backwards. Adding
 * more camSnapLead barely helps; the fix is to quicken the neck for the duration instead.
 */
const SNAP_YAW = 1.6;     // extra follow rate while a snap runs — the big lever
const SNAP_NECK = 1.4;    // ...and the lead itself has to arrive quicker, or it never lands

/**
 * What TUNE.camLead is actually worth on screen, in degrees, at a hard snap: the gain minus
 * the yaw ease's own lag. The tuner labels its slider with this so the readout cannot claim
 * a look-ahead the camera does not deliver.
 */
export const netLeadDeg = (gain) =>
  Math.max(0, (gain - 1 / YAW_K[CAM.POV]) * LEAD_CLAMP) * 180 / Math.PI;

export class CameraRig {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(TUNE.camFov, aspect, 0.12, CFG.render.far);
    this.mode = CAM.POV;
    this.eye = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this._e = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this.shake = 0;
    this.first = true;
    this.yaw = 0;                       // camera bearing, eased toward the travel direction
    this.lead = 0;                      // how far the head is looking ahead of the board
    this.bottom = 0;                    // 0..1, how much of a bottom turn we are in
    this._tvx = 1; this._tvz = 0;       // last good travel direction
    this._lpx = 0; this._lpz = 0;       // last board position, for the velocity estimate
  }

  toggle() { this.mode = this.mode === CAM.CHASE ? CAM.POV : CAM.CHASE; }

  update(dt, sf, surfer, t) {
    const px = sf.px, py = sf.py, pz = sf.pz;

    /*
     * A real world-space follow camera that tracks the BOARD DIRECTION — where the nose is
     * actually pointed — not the surfer's world velocity (which is dragged diagonally
     * shoreward by the wave carrying you, and left the camera stuck on an angle). The board
     * heading comes from the wave frame plus psi. We ease a camera yaw toward it along the
     * SHORTEST arc and damp it, so it follows turns cleanly and a cutback swings round
     * smoothly instead of snapping/flipping the way it used to.
     */
    const tx = sf.tx, tz = sf.tz;              // along-the-line tangent (horizontal)
    const nxh = -tz, nzh = tx;                 // seaward normal (up the face), horizontal
    const cp = Math.cos(surfer.psi), sp = Math.sin(surfer.psi);
    let bx = tx * cp + nxh * sp;               // board heading in the world, horizontal
    let bz = tz * cp + nzh * sp;
    const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;

    const targetYaw = Math.atan2(bz, bx);
    /*
     * Added AFTER the clamp, deliberately. A snap drives turnRate far past LEAD_CLAMP, so the
     * turn-rate term is already pinned at maximum and any extra rotation would be invisible —
     * this stacks the head whip on top of that ceiling instead of disappearing under it.
     */
    // Holds high through the first half of the rotation and eases out — the head arriving at
    // the new sightline and WAITING there while the board catches up. That wait is the whip;
    // a linear decay just reads as drift.
    const snapEnv = surfer.snapDur > 0
      ? smoothstep(0, 1, clamp01(surfer.snapT / surfer.snapDur)) : 0;
    const snapLead = surfer.snapDir * TUNE.camSnapLead * snapEnv;
    const leadTarget = clamp(surfer.turnRate, -LEAD_CLAMP, LEAD_CLAMP)
      * TUNE.camLead * (this.mode === CAM.POV ? 1 : CHASE_LEAD) + snapLead;
    if (this.first) { this.yaw = targetYaw; this.lead = leadTarget; }
    let dyaw = targetYaw - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));            // shortest way round
    this.yaw += dyaw * (1 - Math.exp(-YAW_K[this.mode] * (1 + SNAP_YAW * snapEnv) * dt));
    this.lead = approach(this.lead, leadTarget, LEAD_K * (1 + SNAP_NECK * snapEnv), dt);

    // The BODY (where the rig sits) tracks the board; the HEAD (where it looks) runs ahead of
    // it into the turn. Keeping the lead out of the eye position is the whole point — swing
    // the rig itself and you just orbit the rider instead of turning your head.
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);      // horizontal forward
    const hx = Math.cos(this.yaw + this.lead), hz = Math.sin(this.yaw + this.lead);
    /*
     * Two different "right" vectors, and the distinction matters.
     *
     * bx/bz is the board's TRUE heading; fx/fz is that heading eased. Anything BOLTED TO THE
     * RIDER — the mouth mount and everything it walks through — has to ride the true one, or
     * the mount slides around on the deck through a turn while the ease catches up. The
     * chase rig is not bolted to anyone, so it keeps the eased heading and stays smooth.
     */
    const sx = -bz, sz = bx;    // board-right, for the head-mounted POV
    const rx = -fz, rz = fx;    // eased screen-right, for the chase rig

    // seaward (up-the-face) horizontal direction — keeps the wall in frame
    const ex = nxh, ez = nzh;

    // how much of a bottom turn this is, and therefore how far the head comes off the trim
    // line to find the lip. Off the top this stays at 0 and the framing is unchanged.
    const low = 1 - smoothstep(BOT_U_LO, BOT_U_HI, surfer.u);
    const upSwing = clamp01(surfer.turnRate / BOT_RATE);
    this.bottom = approach(this.bottom, low * upSwing * surfer.onFace, BOT_K, dt);
    const pitch = TUNE.camPitch - this.bottom * TUNE.camLipLift;   // can go above horizontal
    const wall = TUNE.camWall + this.bottom * TUNE.camLipWall;

    if (this.mode === CAM.POV) {
      // Ride on the head: walk the deck with the stance, duck and pitch forward with the
      // compression. The lean term is not decoration — the torso rotates ~0.42 rad as the
      // rider compresses, which throws the head about 0.26 m forward, and a mount that stays
      // put gets overtaken and ends up staring at the back of their own skull.
      const fwd = TUNE.camAhead
        + surfer.w * TUNE.boardLen * 0.26 * TUNE.camWalk   // 0.26 = Rider's stance reach
        + surfer.crouch * TUNE.camDuckFwd;
      // The aim below is built off _e, so camSide carries straight into it: the POV slides
      // sideways as a true dolly, pointing the same way it did before you moved it.
      this._e.set(
        px + bx * fwd + sx * TUNE.camSide,
        py + TUNE.camEye - surfer.crouch * TUNE.camDuck,
        pz + bz * fwd + sz * TUNE.camSide,
      );
      this._a.set(
        this._e.x + hx * POV_AIM + ex * wall,
        this._e.y - Math.sin(pitch) * POV_AIM,
        this._e.z + hz * POV_AIM + ez * wall,
      );
    } else {
      // Sit DIRECTLY behind the nose (no sideways offset toward the wall) so the board points
      // straight into the screen, raised a little. Look ahead along the board heading with a
      // small up-face lift so the wall still frames — the same view as the mouth cam, pulled
      // back behind the rider.
      const back = TUNE.camBack + clamp01(surfer.spd / 20) * 2.2;
      const cw = wall * CHASE_WALL;
      this._e.set(px - fx * back + rx * TUNE.camSide, py + TUNE.camHigh, pz - fz * back + rz * TUNE.camSide);
      // ...whereas this aim is anchored to the RIDER, not to _e, so out here camSide swings
      // the rig round them into a side-on view rather than dollying the whole shot across.
      this._a.set(px + hx * 9 + ex * cw,
        py + TUNE.camHigh - 0.9 + this.bottom * TUNE.camLipLift * 4,
        pz + hz * 9 + ez * cw);
    }

    // keep the lens above water
    this._e.y = Math.max(this._e.y, 0.6);

    if (this.first) { this.eye.copy(this._e); this.aim.copy(this._a); this.first = false; }
    const k = this.mode === CAM.POV ? 14 : 9;
    this.eye.x = approach(this.eye.x, this._e.x, k, dt);
    this.eye.y = approach(this.eye.y, this._e.y, k * 0.8, dt);
    this.eye.z = approach(this.eye.z, this._e.z, k, dt);
    this.aim.x = approach(this.aim.x, this._a.x, k * 0.9, dt);
    this.aim.y = approach(this.aim.y, this._a.y, k * 0.75, dt);
    this.aim.z = approach(this.aim.z, this._a.z, k * 0.9, dt);

    /*
     * Roll into the turn. Driven off surfer.lean — the same value the rider's body uses —
     * rather than off turnRate independently, so the head can never lean one way while the
     * body it is mounted on leans the other. It used to do exactly that: rider.js rolls about
     * its local Z, which makeBasis(r, u, -f) points BACKWARD, so its `-turnRate` reads as a
     * lean into the turn, while the same `-turnRate` about +forward here rolled out of it.
     *
     * Rolled about the direction actually being LOOKED along, or the head lead skews it.
     */
    const bank = clamp(-surfer.lean * TUNE.camRoll, -0.5, 0.5);
    this._u.set(0, 1, 0).applyAxisAngle(this._h.set(hx, 0, hz).normalize(), bank);
    this.up.lerp(this._u, 1 - Math.exp(-8 * dt));

    // shake: foam, wipeouts, raw speed
    this.shake = approach(this.shake,
      clamp01(surfer.foamT * 1.4) * 0.5 + clamp01((surfer.spd - 13) / 12) * 0.12
      + (surfer.alive ? 0 : 0.7), 10, dt);
    const sk = this.shake * 0.13;
    const jx = Math.sin(t * 47.3) * sk, jy = Math.cos(t * 41.7) * sk;

    this.cam.position.copy(this.eye);
    this.cam.position.x += jx; this.cam.position.y += jy;
    this.cam.up.copy(this.up).normalize();
    this.cam.lookAt(this.aim);

    /*
     * The lens stretches with speed and pulls in slightly inside a barrel. The old bounds
     * were the literals 60 and 78, which is exactly base-4 and base+14 off the old fixed 64
     * — so they have to be written that way now, or winding TUNE.camFov wide would just run
     * into a clamp that had no idea the base had moved.
     */
    const lens = TUNE.camFov;
    const targetFov = lens + surfer.spd * CFG.render.fovSpeed + (surfer.barreled ? -4 : 0);
    this.cam.fov = approach(this.cam.fov, clamp(targetFov, lens - 4, lens + 14), 4, dt);
    this.cam.updateProjectionMatrix();
  }

  resize(aspect) {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }
}

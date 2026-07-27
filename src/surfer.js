/**
 * Rider physics — a FREE BODY IN THE WORLD.
 *
 * State is (x, z, spd, psi): a world position on the ocean, a speed, and a heading. psi is
 * measured against the local wave frame — 0 is along the line toward the shoulder, positive
 * angles up toward the lip, negative drops down the face toward the trough — but the surfer
 * is NOT pinned to the wave. Every frame it reads whatever water surface is under its world
 * position (wave.field): the steep pocket, the soft shoulder, the flat inside, or the back
 * of the wave once you run over the top. The wave drifts and peels underneath you.
 *
 * There is no way to "finish". You cannot wipe out, get kicked off, drown, or ride it to the
 * sand — the run only ends when you restart it. The whole skill is keeping the board in the
 * pocket while the pocket moves through the world.
 *
 * Speed comes from where you are, not from holding a key:
 *   1. gravity down the face  — you gain dropping in, you pay climbing to the lip
 *   2. the pocket, which only pushes where the wave is actually standing up and throwing
 * Drag takes it back, turning hard takes it back faster, and off the wave there is nothing
 * to plane on so you simply bog until you work your way back onto the face.
 */
import { CFG } from './config.js';
import { TUNE } from './tuning.js';
import { column, colBeta, colApexU, colAt, pocketPower } from './wave.js';
import { clamp, clamp01, lerp, approach, smoothstep, wrapPi } from './rng.js';

const P = CFG.phys;
const K = CFG.pocket;
const S = CFG.score;

// State is kept for the renderer/HUD, but the surfer is only ever RIDING now — nothing ends
// the run. The other values remain so older callers that reference them still resolve.
export const STATE = { RIDING: 0, WIPEOUT: 2, KICKOUT: 3, FINISHED: 4 };

export { pocketPower };

export class Surfer {
  constructor(wave) {
    this.wave = wave;
    this._field = {};
    this._srf = {};
    this.reset();
  }

  reset() {
    const R = CFG.ride;

    this.b = R.startB;         // break point (curl) along the crest
    this.time = 0;
    this._sGuess = R.startS;

    // Establish the starting world position on the face from the old (s, u, psi) takeoff.
    const sh = this.wave.shape(R.startS, this.b, 0, {});
    column(sh.phi, sh.A);
    const f = this.wave.frame(R.startS);
    const p = colAt(R.startU);
    this.x = f.x + f.nx * p.run;
    this.z = f.z + f.nz * p.run;
    this.s = R.startS;
    this.u = R.startU;

    this.spd = R.startSpd;
    this.psi = R.startPsi;     // heading, relative to the local wave frame

    this.w = 0;                // stance: +1 forward/drive, -1 back/brake
    this.turnRate = 0;
    this.tailPush = 0;
    this.lean = 0;
    this.crouch = 0;
    this.walking = 0;

    this.d = this.s - this.b;
    this.pocket = 0;
    this.vWater = 0;
    this.closing = 0;
    this.peel = 0;
    this.stanceOpt = 0;
    this.trimErr = 0;
    this.alpha = 0;
    this.onFace = 1;

    this.state = STATE.RIDING;
    this.foamT = 0;
    this._shoulder = 1;
    this.tumble = 0;

    this.barreled = false;
    this.barrelT = 0;
    this.topSpd = 0;
    this.dist = 0;

    // scoring
    this.score = 0;
    this.combo = 1;
    this.sPocket = 0;
    this.sBarrel = 0;
    this.sTurns = 0;
    this.sSpeed = 0;
    this.sTrim = 0;
    this.trimT = 0;
    this.turnCount = 0;
    this._swing = 0;
    this._swingDir = 0;
    this._swingPeak = 0;

    this.events = [];
    this.endReason = '';
  }

  push(text, kind) { this.events.push({ text, kind }); }

  /** Sample everything the renderer and camera need about the surface under the board. */
  surface(out) {
    const fd = this.wave.field(this.x, this.z, this.time, this.b, this._sGuess, this._srf);
    this._sGuess = fd.s;
    const cb = Math.cos(fd.beta), sb = Math.sin(fd.beta);

    out.px = this.x;
    out.py = fd.y;
    out.pz = this.z;

    // up-the-face direction on the surface
    out.ux = fd.nx * cb; out.uy = sb; out.uz = fd.nz * cb;
    // along the line
    out.tx = fd.tx; out.ty = 0; out.tz = fd.tz;
    // outward surface normal = uface x t
    let nx = out.uy * out.tz - out.uz * out.ty;
    let ny = out.uz * out.tx - out.ux * out.tz;
    let nz = out.ux * out.ty - out.uy * out.tx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    out.nx = nx * il; out.ny = ny * il; out.nz = nz * il;

    out.beta = fd.beta;
    out.A = fd.A;
    out.phi = fd.phi;
    return out;
  }

  step(dt, input) {
    const wave = this.wave;
    this.time += dt;

    /*
     * Stance. -1 is back over the fins, +1 is forward toward the nose. A position you walk
     * to and leave, not a spring — you are trimming the board.
     */
    this.w = clamp(this.w + input.weight * P.stanceRate * dt, -1, 1);
    this.walking = Math.max(0, (Math.abs(this.w) - P.stepAt) / (1 - P.stepAt));
    const brake = Math.max(0, -this.w);
    const drive = Math.max(0, this.w);

    /* -- read the water under you --------------------------------------- */
    const fd = wave.field(this.x, this.z, this.time, this.b, this._sGuess, this._field);
    this._sGuess = fd.s;
    this.s = fd.s;
    this.u = fd.u;
    this.d = fd.d;
    this.onFace = fd.onFace;
    const beta = fd.beta;
    const onFace = fd.onFace;
    const pw = fd.pocket * onFace;          // no pocket power once you are off the face
    this.pocket = pw;
    this._shoulder = fd.shoulder;

    // heading, resolved against the local frame: cp along the line, sp up the face
    const cp = Math.cos(this.psi), sp = Math.sin(this.psi);
    // world heading unit vector — this is the direction the board actually travels
    let hx = fd.tx * cp + fd.nx * sp;
    let hz = fd.tz * cp + fd.nz * sp;
    const hl = 1 / (Math.hypot(hx, hz) || 1); hx *= hl; hz *= hl;

    /*
     * The face is moving water: orbital flow carries it UP the face near the lip and drops
     * away in the trough. Only exists on the face itself.
     */
    const faceFlow = P.waterUp * pw * fd.steep;
    const vUp = faceFlow * (clamp01(this.u) - P.liftZero) / (1 - P.liftZero);

    // ground speed floor from holding station on a moving wave (only while on the face)
    const carry = P.carryFrac * (fd.c / Math.max(0.30, Math.sin(fd.pa)))
      * (0.35 + 0.65 * fd.stand) * onFace;
    this.vWater = Math.hypot(this.spd, carry);
    const vw = this.vWater;

    /* -- steering -------------------------------------------------------- */
    const grip = 1 / (1 + vw / P.turnSpdRef);
    const lenR = TUNE.boardLen / P.boardRefLen;
    const finLever = P.finLeverBase + P.finLeverGain * TUNE.finPos;
    const tailLev = clamp01(P.tailLevBase + P.tailLevGain * (P.tailLevPivot - this.w));
    this.tailPush = approach(this.tailPush, (input.tail || 0) * tailLev, 12, dt);

    const flow = clamp01((vw + faceFlow * 0.45) / P.railFlow);
    const carve = P.turnBase * (1 - P.turnDriveDamp * drive) * grip * (0.20 + 0.80 * flow) / lenR;
    const pivot = P.turnPivot * this.tailPush * (0.35 + 0.65 * flow) * finLever / Math.sqrt(lenR);
    let dpsi = input.steer * (carve + pivot);
    // gravity gently drops the nose down the face when you are just riding along
    if (Math.abs(this.psi) < P.gravTurnTo) {
      dpsi -= P.gravTurn * Math.sin(beta) * Math.cos(this.psi) * clamp01(this.spd / 6) * onFace;
    }
    this.turnRate = approach(this.turnRate, dpsi, 12, dt);
    this.psi = wrapPi(this.psi + this.turnRate * dt);

    /* -- longitudinal forces --------------------------------------------- */
    // gravity along the surface: down the face on the wave, off the back once you go over.
    const lift = P.liftGain * vUp;
    const aGrav = (P.G * TUNE.gravity * fd.slopeSeaward + lift) * sp;

    const faceBand = Math.exp(-Math.pow((clamp01(this.u) - K.faceCenter) / K.faceWidth, 2));
    const shapePow = 1 - P.pushSteep + P.pushSteep * fd.steep;
    const aPush = P.push * pw * faceBand * shapePow;
    const aPump = P.pumpGain * drive * Math.max(0, -sp) * pw * faceBand;

    /*
     * The wave is a MOVING hill. It advances shoreward under you at its celerity, so the face
     * is a downhill that never runs out — a treadmill. Rather than a one-off drop, it carries
     * your speed UP toward a cruising speed set by how fast the wave is moving, along the
     * whole standing face (not just the curl). That is why a 2 m face still bombs you along
     * the whole way in. You can still beat this floor by pumping and dropping; it only ever
     * pulls you up, never brakes you.
     */
    // The steeper the moving face, the faster the downhill it presents. A hollow section
    // bombs you; a fat, gentle section carries far less — so you lose speed on the fat bits
    // and have to point down and keep the board planing to hold what you have. `phi` is the
    // actual face steepness (fat ~0.4, vertical/hollow ~1.6+).
    const faceSteep = clamp01((fd.phi - 0.35) / 1.15);
    // The effective up-flow is strongest on the upper-mid face and dies in the trough, so the
    // FAST line is high and the trough is the slow zone (Surf Simply / Landell-Mills). That is
    // what makes the roller-coaster line pay: drop for speed off gravity, then carry it high.
    const height = clamp01((this.u + 0.08) / 0.6);              // ~0 at the trough, 1 up high
    const onWall = (0.15 + 0.85 * height) * fd.stand;
    const vGlide = P.waveGlide * fd.c * (0.2 + 0.8 * faceSteep) * onWall;
    const aWave = Math.max(0, vGlide - this.spd) * P.waveGrab;

    /*
     * Turning MAKES speed by redirecting the rising water. A hard bottom turn banks the board
     * against the up-flow at ~90 deg and converts it to thrust, so you come out FASTER than
     * you went in (Surf Simply / Landell-Mills). Gated by the up-flow energy (pocket * steep)
     * rather than a mid-face band, so it works low on the face where the bottom turn happens.
     */
    const om = Math.abs(this.turnRate);
    const bite = P.finBiteBase + P.finBiteGain * TUNE.finPos;
    const upFlow = pw * (0.35 + 0.65 * fd.steep);
    const aTurn = Math.min(P.turnDriveMax, TUNE.turnDrive * P.btGain * om * om * upFlow * flow)
      * bite * clamp01(1 - vw / P.turnDriveCeil);

    const alpha = TUNE.trim - P.trimStance * this.w;
    const alphaReq = Math.sqrt(P.liftNeed / (Math.max(6, vw * vw) * lenR));
    this.alpha = alpha;
    this.trimErr = alpha - alphaReq;
    this.stanceOpt = clamp((TUNE.trim - alphaReq) / P.trimStance, -1, 1);
    const over = Math.max(0, this.trimErr) * (1 - P.trimTurnRelief * clamp01(om / 1.6));
    const under = Math.max(0, -this.trimErr);
    const plane = P.planeBase + P.trimOver * over + P.trimUnder * under * (1 + 4 * under);
    const dig = Math.max(brake, this.tailPush);
    const railBite = (P.railDrive + (P.railBrake - P.railDrive) * dig) * bite;
    const glide = P.dragLin * (1 - P.lenGlide * (lenR - 1));
    let aDrag = -plane * (glide * this.spd + P.dragQuad * vw * this.spd)
      - TUNE.railDrag * railBite * om * this.spd;
    // off the face — the back or the deep inside — there is no wall to plane on, so you bog
    if (onFace < 0.5) aDrag -= P.dragLin * 3.0 * this.spd;
    if (this.u < -0.2) aDrag -= P.dragLin * P.flatsGlide * this.spd;   // gliding the inside

    this.spd = Math.max(0, this.spd + (aGrav + aPush + aPump + aTurn + aWave + aDrag) * dt);
    this.topSpd = Math.max(this.topSpd, this.vWater);

    /* -- integrate WORLD position ---------------------------------------- */
    const ds = this.spd * dt;
    this.x += hx * ds;
    this.z += hz * ds;
    this.dist += ds;

    /*
     * The wave carries its water — and you — shoreward as it advances, so it does not simply
     * wash past and leave you on the back. This is what catching a wave is: you travel WITH
     * it, and your own board speed is what moves you AROUND on the face. It only holds while
     * you are actually on the wave; run over the back (onFace = 0) and it lets go of you, so
     * the wave rolls on without you and you have genuinely lost it.
     */
    const carryStep = wave.driftSpeed * dt * onFace;
    this.x += wave._advX * carryStep;
    this.z += wave._advZ * carryStep;

    /*
     * The wave stands up under you and keeps lifting you back onto the face if you drop too
     * low — an UPWARD-only push (+normal), the rising water of the moving wave. It never pulls
     * you down, so it is not the old skid; it just stops a small face from dumping you off the
     * base. Drive the nose down hard and your own motion still beats it, so you can dive off
     * the bottom and head for the beach when you mean to.
     */
    if (this.u < P.wallCatch && onFace > 0.5) {
      const catchUp = P.wallLift * fd.stand * (P.wallCatch - this.u);
      this.x += fd.nx * catchUp * dt;
      this.z += fd.nz * catchUp * dt;
    }

    /*
     * Rail grip (Coanda). A rail set at speed grips the face and draws the board UP into the
     * wave, letting you hold and climb a high line instead of sliding off it. It needs speed
     * (nose-riding fails when slow) and eases off approaching the lip so it holds you on a
     * high line rather than throwing you over the top. This is the rail gripping the water,
     * not the fins.
     */
    if (onFace > 0.5) {
      // draw up to a high trim line (or the apex, if the section barrels below it) and hold
      // there — to go higher you have to aim the nose up; the grip alone will not throw you
      // over the lip
      const hi = Math.min(P.gripLine, colApexU());
      const grip = P.railGrip * clamp01(vw / P.gripSpeed) * fd.stand
        * clamp01((hi - this.u) / 0.4);
      this.x += fd.nx * grip * dt;
      this.z += fd.nz * grip * dt;
    }

    /*
     * NB: no along-line "sweep" any more. The treadmill drive (aWave) gives you real speed
     * down the line, so you keep pace with the peel under your own steam — outrun it onto the
     * shoulder and the face flattens and slows you until the curl catches back up, fall
     * behind and you bog in the foam. That balance settles you into the pocket on its own,
     * and holding the fast line there is the skill. Where you sit UP the face is purely where
     * the fins point (the heading integration above) — the board tracks, it does not skid.
     */

    /* -- the break point keeps peeling ----------------------------------- */
    const peel = wave.peelAt(this.b);
    this.closing = this.spd * cp - peel;
    this.peel = peel;
    this.b += peel * dt;

    /* -- in the tube ----------------------------------------------------- */
    const apex = colApexU();
    const inTube = onFace > 0.5 && fd.phi > 1.75 && this.u < apex && this.u > 0.18
      && fd.hollow > 0.45 && pw > 0.25;
    if (inTube && !this.barreled) this.push('PITTED', 'tube');
    if (inTube) { this.barrelT += dt; this.sBarrel += S.barrelRate * dt * this.combo; }
    this.barreled = inTube;

    /* -- foam, for camera shake only — it cannot kill you any more -------- */
    if (this.d < K.foamEnter && onFace > 0.5) this.foamT = Math.min(2, this.foamT + dt);
    else this.foamT = Math.max(0, this.foamT - dt * 1.8);

    /* -- scoring: reward being in the pocket ----------------------------- */
    this._scoreTurns(dt);

    const trimming = pw > 0.5 && Math.abs(this.turnRate) < 0.28 && this.spd > 8 && this.u > 0.18;
    if (trimming) {
      this.trimT += dt;
      this.sTrim += S.trimRate * dt * this.combo;
      if (this.trimT > 2.2) {
        this.trimT = 0;
        this.combo = Math.min(S.comboMax, this.combo + 0.2);
        this.push('TRIM', 'trim');
      }
    } else this.trimT = Math.max(0, this.trimT - dt * 2);

    this.sPocket += S.pocketRate * pw * dt * this.combo;
    this.sSpeed += S.speedRate * (this.spd / 14) * pw * dt;
    if (pw > 0.5) this.combo = Math.min(S.comboMax, this.combo + S.comboStep * dt);
    else this.combo = Math.max(1, this.combo - S.comboDecay * dt);
    this.score = this.sPocket + this.sBarrel + this.sTurns + this.sSpeed + this.sTrim
      + this.dist * S.distRate;

    /* -- cosmetics ------------------------------------------------------- */
    this.lean = approach(this.lean, clamp(-this.turnRate * 0.55, -0.85, 0.85), 9, dt);
    this.crouch = approach(this.crouch,
      clamp01(brake * 0.8 + Math.abs(this.turnRate) * 0.35 + (1 - pw) * 0.1), 7, dt);
  }

  /** Reward a completed direction change: bigger swing + more speed kept = better. */
  _scoreTurns(dt) {
    const dp = this.turnRate * dt;
    this._swingPeak = Math.max(this._swingPeak, Math.abs(this.psi));
    const dir = Math.sign(dp);
    if (dir !== 0 && dir !== this._swingDir) {
      if (Math.abs(this._swing) > 0.62 && this.spd > 5) {
        const amp = Math.min(Math.abs(this._swing), 3.2);
        const fast = clamp01(this.spd / 15);
        const sharp = clamp01(Math.abs(this.turnRate) / 1.4);
        const back = this._swing > 0;
        const cutback = back && this._swingPeak > 1.62;
        const gain = S.turnBase * amp * (0.45 + 0.85 * fast) * (cutback ? 1.6 : 1) * this.combo;
        this.sTurns += gain;
        this.turnCount++;
        this.combo = Math.min(S.comboMax, this.combo + (cutback ? 0.45 : 0.28));
        const label = back
          ? (cutback ? 'CUTBACK' : (sharp > 0.55 && amp > 1.2 ? 'OFF THE TOP' : 'CARVE'))
          : (sharp > 0.6 ? 'BOTTOM TURN' : 'DRIVE');
        this.push(label, back ? 'snap' : 'carve');
      }
      this._swing = 0;
      this._swingPeak = Math.abs(this.psi);
      this._swingDir = dir;
    }
    this._swing += dp;
  }

  update(dt, input) {
    this.events.length = 0;
    this.step(dt, input);
  }

  /** The run never ends on its own any more — you free-roam until you restart. */
  get alive() { return true; }
}

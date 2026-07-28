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
const N = CFG.snap;
const PU = CFG.pump;
const BR = CFG.brake;

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

    // the snap — see CFG.snap and _fireSnap()
    this.snapT = 0;        // seconds of rotation left to run
    this.snapDur = 0;      // ...out of this many, so the camera can shape an envelope
    this.snapRate = 0;     // rad/s, driven straight into psi
    this.snapDir = 1;
    this.snapQ = 0;        // grade of the last snap, 0..1 — read by the HUD and the camera
    this.snapDeg = 0;
    this.snapCool = 0;
    this.stallT = 0;       // bogged after a blown one
    this.snapCount = 0;
    this.bestSnap = 0;

    this.pumpT = 0;        // decaying flag for the HUD and effects
    this.pumpCool = 0;
    this.pumpQ = 0;
    // The pump chain. pumpSince starts high so the first pump of a ride is never a link.
    this.pumpLink = 1;     // multiplier on the current chain, 1 = a single unlinked pump
    this.pumpSince = 1e3;  // seconds since the last pump, for the rhythm window
    this.pumpCeil = 0;     // the speed ceiling the wave under you will actually support
    this.braking = false;  // held: set by the brake channel, lasts until you let go
    this.brakeT = 0;       // how long it has been buried, for the HUD and effects
    this.brakeCool = 0;
    this.brakeLev = 0;     // leverage over the tail at the current stance

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
    this._swingRate = 0;   // peak |turnRate| over the current arc

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

    /*
     * Ground speed floor from holding station on a moving wave (only while on the face).
     *
     * A held brake defeats it. This term exists because a planing board on a moving face gets
     * translated along with the wave — but bogging the tail is precisely the act of stopping
     * planing, and once you are sitting in the water the wave passes under you and goes on
     * without you. Leaving `carry` untouchable made it an unbeatable ~18 km/h floor: you could
     * stand on the brake and watch the speedo refuse to move, because the number on the HUD is
     * vWater, which can never fall below carry however hard you stop the board.
     */
    /*
     * The brake reads its OWN leverage curve, not the tail stamp's. A stamp is a jab you can
     * throw from most of the deck, but bogging the tail means actually standing on it — so this
     * one is near zero at dead centre and only comes on as you commit to the back foot. Stance
     * is the control; the button only asks.
     *
     * Computed up here, above `carry`, because carry now depends on it — read any later and it
     * would be a substep stale.
     */
    const brakeLev = clamp01(BR.levBase + BR.levGain * (BR.levPivot - this.w));
    this.brakeLev = brakeLev;      // the HUD reads this to show how much bite you actually have

    const carryCut = this.braking ? 1 - BR.carryCut * brakeLev : 1;
    const carry = P.carryFrac * (fd.c / Math.max(0.30, Math.sin(fd.pa)))
      * (0.35 + 0.65 * fd.stand) * onFace * carryCut;
    this.vWater = Math.hypot(this.spd, carry);
    const vw = this.vWater;

    /* -- steering -------------------------------------------------------- */
    const grip = 1 / (1 + vw / P.turnSpdRef);
    const lenR = TUNE.boardLen / P.boardRefLen;
    const finLever = P.finLeverBase + P.finLeverGain * TUNE.finPos;
    const tailLev = clamp01(P.tailLevBase + P.tailLevGain * (P.tailLevPivot - this.w));
    this.tailPush = approach(this.tailPush, (input.tail || 0) * tailLev, 12, dt);

    /*
     * THE SNAP. Double-tapping the tail breaks the board loose in one explosive rotation.
     *
     * Note this is checked BEFORE the ordinary steering below and then overrides it. It has
     * to: everything in the normal path is a lag (tailPush 83 ms -> pivot -> dpsi -> turnRate
     * another 83 ms), so a snap routed through it would arrive a third of a second late and
     * mushy. Here psi is driven directly and turnRate is *assigned* rather than approached,
     * which also means lean, camera roll, spray and the audio hiss bed all read the snap for
     * free without any of them knowing it exists.
     */
    // hoisted: aTurn reads this further down, outside the snap branch below
    const flow = clamp01((vw + faceFlow * 0.45) / P.railFlow);

    this.snapCool = Math.max(0, this.snapCool - dt);
    this.stallT = Math.max(0, this.stallT - dt);
    this.pumpT = Math.max(0, this.pumpT - dt);
    this.pumpCool = Math.max(0, this.pumpCool - dt);
    this.brakeCool = Math.max(0, this.brakeCool - dt);
    /*
     * The rhythm clock. Let the window lapse and the chain drops back to a single, so a run of
     * pumps has to be kept up to be worth anything — you cannot bank a multiplier and cash it
     * in three seconds later.
     */
    this.pumpSince += dt;
    if (this.pumpSince > PU.linkWin) this.pumpLink = 1;

    if (input.takeDouble) {
      // A snap needs a direction to go: the double-tap breaks the tail loose, the steer is
      // what it breaks loose INTO. Tapping with no rail engaged is not a manoeuvre.
      if (input.takeDouble('tail') && input.steer !== 0
          && this.snapT <= 0 && this.snapCool <= 0 && onFace > 0.5) {
        this._fireSnap(fd, input);
      }
      if (input.takeDouble('up') && this.pumpCool <= 0 && onFace > 0.5) {
        this._firePump(fd, pw, hx, hz);
      }
      if (input.takeDouble('down') && this.brakeCool <= 0) this._fireBrake(brakeLev);
    }
    /*
     * The brake is HELD, on its own channel, and lasts until you let go. It used to end the
     * moment weight >= 0, which meant holding the brake and walking backward were the same act
     * — you could not brake from mid-stance, and the hold dragged your stance to the tail
     * whether you wanted it there or not. Now the two are independent: the walk decides how
     * much tail you have, the brake decides whether you are leaning on it.
     */
    if (this.braking && !input.brake) { this.braking = false; this.brakeT = 0; }
    if (this.braking) this.brakeT += dt;

    if (this.snapT > 0) {
      const step = Math.min(dt, this.snapT);
      this.psi = wrapPi(this.psi + this.snapDir * this.snapRate * step);
      this.snapT -= step;
      this.turnRate = this.snapDir * this.snapRate;
      if (this.snapT <= 0) {
        // Hand the arc back to _scoreTurns clean, or it reads the whole snap as a swing it
        // just watched happen and pays out a phantom cutback on top of the snap's own score.
        this._swing = 0;
        this._swingDir = 0;
        this._swingPeak = Math.abs(this.psi);
        this._swingRate = 0;
      }
    } else {
      const carve = P.turnBase * (1 - P.turnDriveDamp * drive) * grip * (0.20 + 0.80 * flow) / lenR;
      const pivot = P.turnPivot * this.tailPush * (0.35 + 0.65 * flow) * finLever / Math.sqrt(lenR);
      let dpsi = input.steer * (carve + pivot);
      // gravity gently drops the nose down the face when you are just riding along
      if (Math.abs(this.psi) < P.gravTurnTo) {
        dpsi -= P.gravTurn * Math.sin(beta) * Math.cos(this.psi) * clamp01(this.spd / 6) * onFace;
      }
      this.turnRate = approach(this.turnRate, dpsi, 12, dt);
      this.psi = wrapPi(this.psi + this.turnRate * dt);
    }

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
    /*
     * Cap the rotation rate that the turn-drive and rail-drag terms are allowed to see while
     * a snap is running. Both were written for a carve, where |turnRate| tops out around 4:
     * aTurn goes as om^2, so at a snap's 10-16 rad/s it saturates turnDriveMax outright and a
     * BLOWN snap would collect exactly as much drive as a perfect one, and rail drag goes as
     * om, so it would scrub speed by how fast you spun rather than by how well you did it.
     * The snap pays and rewards through _fireSnap instead, on quality.
     */
    const om = this.snapT > 0
      ? Math.min(Math.abs(this.turnRate), N.omCap)
      : Math.abs(this.turnRate);
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
    // a blown snap does not just cost you the speed, it leaves you bogged for a moment
    if (this.stallT > 0) aDrag -= P.dragLin * N.stallDrag * this.spd;
    /*
     * The bogged tail, for as long as you keep your weight on it. This is the brake — not the
     * initial set, which is deliberately gentle. Both terms scale by how much tail you are
     * actually standing over.
     *
     * Two terms because they do different jobs: the proportional one dumps speed hard while you
     * still have some, and the constant one carries you the rest of the way to an actual stop
     * (spd is floored at 0 below, so it can never reverse you).
     */
    if (this.braking) {
      aDrag -= P.dragLin * BR.holdDrag * brakeLev * this.spd;
      aDrag -= BR.holdStop * brakeLev;
    }
    /*
     * A pump unweights the board as it unloads, and an unweighted board is a fast one. Applied
     * LAST, as a scale on the whole accumulated drag, because the point is to briefly relieve
     * every source of it at once — that is what "reduce friction" means, and it is what makes a
     * pump's speed persist for long enough to be worth linking off.
     */
    if (this.pumpT > 0) aDrag *= 1 - PU.slip * clamp01(this.pumpT / PU.show);

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
    // not while a snap is rotating — _fireSnap already paid for that arc
    if (this.snapT <= 0) this._scoreTurns(dt);

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

  /**
   * Grade a snap off WHERE YOU ARE and let it rip. Nothing here reads how long you held
   * anything — the whole mechanic is timing and position on the wave.
   *
   * The three face terms are what a snap is actually made of, and they are summed rather than
   * multiplied: a product would let any single zero (flat section, nose pointing the wrong
   * way) annihilate the whole thing, and then speed could never rescue a bad setup the way it
   * should. Speed comes in as a separate share on top, so a fast rider can force a workable
   * snap out of a section that has not stood up, but can never buy a perfect one.
   */
  _fireSnap(fd, input) {
    /*
     * How far up the face you are, normalised by the HIGHEST point you could possibly reach
     * here. This has to be normalised: uFromRun caps u at the apex, and the apex is only 0.64
     * right at the curl (it opens to 1.0 out on the fat shoulder). Grading raw u against a
     * fixed threshold would make a perfect pocket snap literally unscoreable.
     */
    const apex = colApexU();
    const height = clamp01(this.u / Math.max(0.20, apex));
    const vert = clamp01((fd.phi - N.phiLo) / (N.phiHi - N.phiLo));
    // Driving UP the face. Pointing down it is not an attack angle, it is a drop. Raised to
    // a power because plain sin() was far too kind to a half-committed climb.
    const attack = Math.pow(clamp01(Math.sin(Math.max(0, this.psi))), N.attackExp);
    const fast = clamp01(this.spd / TUNE.snapSpeed);

    // Attack angle both carries its own share AND gates the section terms, so a vertical wall
    // hit with the nose pointed down the face cannot score like a snap — it is a drop.
    const setup = (N.wVert * vert + N.wHeight * height)
        * (N.atkFloor + (1 - N.atkFloor) * attack)
      + N.wAttack * attack;
    const q = clamp01(Math.pow(setup, N.setupExp) * (1 - N.spdShare) + fast * N.spdShare);
    const deg = lerp(TUNE.snapMin, TUNE.snapMax, Math.pow(q, N.degExp));

    this.snapDir = Math.sign(input.steer);   // gated on a non-zero steer by the caller
    const dur = lerp(N.durMin, N.durMax, q);
    this.snapRate = (deg * Math.PI / 180) / dur;
    this.snapT = dur;
    this.snapDur = dur;
    this.snapCool = N.cool;
    this.snapQ = q;
    this.snapDeg = deg;
    this.snapCount++;
    this.bestSnap = Math.max(this.bestSnap, q);

    // A clean snap redirects your energy; a blown one dumps it on the deck and bogs you.
    this.spd *= lerp(TUNE.snapKeep, N.keepBest, q);
    if (q < N.blownQ) this.stallT = N.stallTime * (1 - q / N.blownQ);

    const full = deg >= 180;
    if (q >= N.blownQ) {
      this.sTurns += S.turnBase * (0.6 + 2.2 * q) * this.combo;
      this.combo = Math.min(S.comboMax, this.combo + 0.25 + 0.4 * q);
    }
    /*
     * A weak snap out where there is no pocket is not a mistake — it is a speed check, the
     * standard way to scrub off a few knots and let the section come to you. Only call it
     * blown if you tried it somewhere it should have worked.
     */
    const checking = fd.pocket < 0.35;
    const label = full ? 'REVERSE'
      : q >= 0.72 ? 'PERFECT SNAP'
        : q >= 0.48 ? 'CLEAN SNAP'
          : checking ? 'SPEED CHECK'
            : q >= N.blownQ ? 'SNAP' : 'BLOWN IT';
    this.push(label, full || q >= 0.72 ? 'snapfull' : q >= 0.48 ? 'snapgood'
      : checking || q >= N.blownQ ? 'snapok' : 'blown');
  }

  /**
   * A PUMP. Spring forward off the front foot, unstick the rail, drive off the rising water,
   * then settle back down onto the face. A power trim.
   *
   * Gated on there actually being rising water to push against: a stood-up pocket pays, a dead
   * shoulder or the flat inside pays nothing. `room` keeps it honest — the closer you already
   * are to the ceiling the less it returns — so a pump tops you up toward the wave's speed
   * instead of ratcheting past it.
   *
   * LINKING is the point. Land the next one in rhythm and the chain multiplier climbs, so speed
   * comes from stringing pumps together rather than from any single one. Break the rhythm and it
   * resets. `room` multiplies the chained gain too, so a long chain reaches the ceiling faster
   * without ever going through it.
   */
  _firePump(fd, pw, hx, hz) {
    const steepq = clamp01((fd.phi - 0.35) / 1.15);
    const q = clamp01(pw * (0.35 + 0.65 * steepq) * fd.stand);
    /*
     * Stance scales the drive instead of being shoved by it. A pump springs off the FRONT foot,
     * so forward is where the power lives; parked back over the fins there is nothing to extend
     * against. The old version threw your stance forward for you, which meant the manoeuvre
     * picked your trim — now you pick it and the pump pays out accordingly.
     */
    const lev = lerp(PU.levTail, PU.levNose,
      clamp01((this.w - PU.levPivot) / (1 - PU.levPivot)));
    // rhythm: still inside the window since the last pump means this one links onto it
    this.pumpLink = this.pumpSince <= PU.linkWin
      ? Math.min(PU.linkMax, this.pumpLink + PU.linkStep)
      : 1;
    this.pumpSince = 0;
    /*
     * The ceiling this wave will actually support. A steep, stood-up pocket has speed in it; fat
     * water does not, no matter how well you pump or how long the chain. This is the cap on
     * linking — the chain gets you to the wave's limit faster, it cannot argue with the limit.
     */
    const ceil = lerp(PU.ceilMin, PU.ceilMax, clamp01(fd.stand * (0.35 + 0.65 * steepq)));
    const room = clamp01(1 - this.vWater / ceil);
    this.pumpCeil = ceil;
    /*
     * base is the floor every landed pump is worth; gain is what placement and stance add. Only
     * `room` scales the floor, so a pump is always worth having until the wave itself runs out
     * of speed to give.
     */
    this.spd += (PU.base + PU.gain * q * lev) * this.pumpLink * room;
    /*
     * ...and it carries you up the face, which is where that speed actually came from. Gated
     * against the same high line the rail grip uses: pumping drives you up the wall, it does
     * not launch you over the back of it, and without this ceiling repeated pumps would walk
     * you straight past the apex and off the shoulder.
     */
    const hi = Math.min(P.gripLine, colApexU());
    const up = q * clamp01((hi - this.u) / 0.4);
    this.x += fd.nx * PU.lift * up;
    this.z += fd.nz * PU.lift * up;
    /*
     * ...and it throws the whole board FORWARD, because a pump is a jump. The speed bump alone
     * read as the numbers going up rather than as an athletic movement; a real displacement along
     * the heading is what makes it feel like leaving the water and landing further down the line.
     *
     * Along the heading, so it goes where the board is pointed — down the line when you are
     * trimming, up the face when you are climbing. Counted into `dist` because you genuinely
     * travelled it.
     */
    this.x += hx * PU.hop;
    this.z += hz * PU.hop;
    this.dist += PU.hop;
    this.pumpQ = q;
    this.pumpT = PU.show;
    this.pumpCool = PU.cool;
    // Report the chain, because it is the thing the player is trying to build. A single pump
    // stays quiet at low quality, but a link always reads — that feedback IS the rhythm cue.
    if (this.pumpLink > 1.01) this.push(`PUMP x${this.pumpLink.toFixed(1)}`, 'pump');
    else if (q > 0.30) this.push('PUMP', 'pump');
  }

  /**
   * SET A BRAKE. Lean back onto the tail and keep slowing until you let go.
   *
   * The initial set is only a small check — nearly all the speed loss comes from the sustained
   * drag while `braking` is true, which is what makes it a hold rather than a one-shot tap.
   *
   * Strength is entirely your leverage over the tail, and this does NOT walk your stance to get
   * it. Standing at dead centre there is no tail under you and the brake does close to nothing;
   * to stop hard you have to walk back first and commit. That is the decision the mechanic is
   * about, and moving the stance for you would make it for you.
   */
  _fireBrake(lev) {
    this.spd *= lerp(BR.cutNose, BR.cutTail, lev);
    this.braking = true;
    this.brakeT = 0;
    this.brakeCool = BR.cool;
    // Naming what you actually got: leaning on a brake you have no leverage for is a real and
    // instructive outcome, so say so rather than reporting a brake that never happened.
    this.push(lev > 0.62 ? 'HARD BRAKE' : lev > 0.22 ? 'CHECK' : 'NO TAIL', 'brake');
  }

  /** Reward a completed direction change: bigger swing + more speed kept = better. */
  _scoreTurns(dt) {
    const dp = this.turnRate * dt;
    this._swingPeak = Math.max(this._swingPeak, Math.abs(this.psi));
    this._swingRate = Math.max(this._swingRate, Math.abs(this.turnRate));
    const dir = Math.sign(dp);
    if (dir !== 0 && dir !== this._swingDir) {
      if (Math.abs(this._swing) > 0.62 && this.spd > 5) {
        const amp = Math.min(Math.abs(this._swing), 3.2);
        const fast = clamp01(this.spd / 15);
        /*
         * How hard the arc was, measured as the PEAK rate over it rather than the rate right
         * now. "Now" is the substep the rate crossed zero to trigger this branch, so it is
         * near zero by construction — which is why OFF THE TOP (needs 0.55) and BOTTOM TURN
         * (needs 0.6) were unreachable and every turn read as a CARVE or a DRIVE.
         */
        const sharp = clamp01(this._swingRate / 1.4);
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
      this._swingRate = 0;
      this._swingDir = dir;
    }
    this._swing += dp;
  }

  /*
   * NB: this does NOT clear `events` — main.js calls clearEvents() once per rendered frame.
   * It used to clear here, which quietly threw most of them away: the physics runs several
   * fixed substeps per frame, so only whatever the LAST substep happened to emit survived to
   * be seen. Turn callouts were being dropped about half the time, and a snap (which fires on
   * exactly one substep) would have been worse.
   */
  update(dt, input) {
    this.step(dt, input);
  }

  clearEvents() { this.events.length = 0; }

  /** The run never ends on its own any more — you free-roam until you restart. */
  get alive() { return true; }
}

/**
 * Rider physics, in wave coordinates.
 *
 * State is (s, u, spd, psi): where you are along the line, how high up the face, how fast,
 * and which way the board points. psi = 0 is straight down the line at the shoulder,
 * positive is angled up toward the lip, negative is angled down toward the trough.
 *
 * Speed comes from two places and that is the whole game:
 *   1. gravity  -G sin(beta) sin(psi)  — you gain dropping, you pay climbing
 *   2. the pocket, which only pushes you if you are actually in it
 * Drag takes it all back, and turning hard takes it back faster.
 */
import { CFG } from './config.js';
import { TUNE } from './tuning.js';
import { column, colBeta, colL, colApexU, colAt } from './wave.js';
import { clamp, clamp01, lerp, approach, smoothstep, wrapPi } from './rng.js';

const P = CFG.phys;
const WV = CFG.wave;
const K = CFG.pocket;
const S = CFG.score;

export const STATE = { RIDING: 0, AIR: 1, WIPEOUT: 2, KICKOUT: 3, FINISHED: 4 };

/**
 * How much of the wave's energy reaches you at d metres ahead of the curl.
 *
 * Behind the curl this has to reach exactly 1.0 at d=0 to meet the plateau in front of it.
 * A flat 0.7 ceiling there put a 30% step in the main propulsion term at precisely the
 * line you cross most often when riding deep, which reads as an invisible lurch. The
 * `0.7 + 0.3*fade` shaping keeps the intent — the foam gives you less — while landing on
 * 1.0 at the curl itself.
 */
export function pocketPower(d, shoulder = 1) {
  if (d < 0) {
    const fade = clamp01(1 + d / K.behindFade);
    return fade * (0.7 + 0.3 * fade);
  }
  const peak = K.peakEnd * shoulder;
  if (d <= peak) return 1;
  return Math.exp(-Math.pow((d - peak) / (K.tail * shoulder), K.tailExp));
}

export class Surfer {
  constructor(wave) {
    this.wave = wave;
    this.reset();
  }

  reset() {
    const R = CFG.ride;
    this.s = R.startS;
    this.u = R.startU;
    this.spd = R.startSpd;
    this.psi = R.startPsi;
    this.w = 0;            // weight: +1 forward/drive, -1 back/brake
    this.turnRate = 0;
    this.tailPush = 0;
    this.lean = 0;
    this.crouch = 0;

    this.b = R.startB;     // break point
    this.d = this.s - this.b;
    this.pocket = 0;
    this.vWater = 0;
    this.closing = 0;
    this.peel = 0;
    this.walking = 0;
    this.stanceOpt = 0;
    this.trimErr = 0;
    this.alpha = 0;
    this.state = STATE.RIDING;
    this.time = 0;
    this.foamT = 0;
    this._bounceCd = 0;
    this._shoulder = 1;
    this.shoulderT = 0;
    this.airT = 0;
    this.airY = 0;
    this.airVy = 0;
    this.airOut = 0;    // how far the lip has thrown you shoreward, metres
    this.airOutV = 0;
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

    this.events = [];      // { text, kind } consumed by the HUD/audio each frame
    this.shape = {};
    this.endReason = '';
  }

  /** Sample everything the renderer and camera need about the surface under the board. */
  surface(out) {
    const sh = this.wave.shape(this.s, this.b, this.time, this.shape);
    column(sh.phi, sh.A);
    const f = this.wave.frame(this.s);
    const p = colAt(this.u);
    const beta = colBeta(this.u);
    const cb = Math.cos(beta), sb = Math.sin(beta);

    const run = p.run - this.airOut;      // the lip throws you toward the beach
    out.px = f.x + f.nx * run;
    out.py = p.ht + this.airY;
    out.pz = f.z + f.nz * run;

    // up-the-face direction on the surface
    out.ux = f.nx * cb; out.uy = sb; out.uz = f.nz * cb;
    // along the line
    out.tx = f.tx; out.ty = 0; out.tz = f.tz;
    // outward surface normal = uface x t  (see the handedness note in Wave.frame)
    let nx = out.uy * out.tz - out.uz * out.ty;
    let ny = out.uz * out.tx - out.ux * out.tz;
    let nz = out.ux * out.ty - out.uy * out.tx;
    const il = 1 / (Math.hypot(nx, ny, nz) || 1);
    out.nx = nx * il; out.ny = ny * il; out.nz = nz * il;

    out.beta = beta;
    out.A = sh.A;
    out.phi = sh.phi;
    return out;
  }

  push(text, kind) { this.events.push({ text, kind }); }

  step(dt, input) {
    if (this.state === STATE.WIPEOUT || this.state === STATE.FINISHED) {
      this.tumble += dt;
      this.time += dt;
      return;
    }

    const wave = this.wave;
    this.time += dt;

    /*
     * Stance. -1 is back over the fins, +1 is forward toward the nose. This is a POSITION
     * you walk to and leave, not a spring-loaded lean — you are trimming the board, and a
     * board does not un-trim itself because you stopped pushing. Small shifts are weight;
     * past `stepAt` you are actually walking up and down the deck.
     */
    this.w = clamp(this.w + input.weight * P.stanceRate * dt, -1, 1);
    this.walking = Math.max(0, (Math.abs(this.w) - P.stepAt) / (1 - P.stepAt));
    const brake = Math.max(0, -this.w);
    const drive = Math.max(0, this.w);

    /* -- local wave shape ------------------------------------------------ */
    const sh = wave.shape(this.s, this.b, this.time, this.shape);
    column(sh.phi, sh.A);
    const L = colL();
    const beta = colBeta(this.u);
    this.d = this.s - this.b;
    const pw = pocketPower(this.d, sh.shoulder);
    this.pocket = pw;
    this._shoulder = sh.shoulder;

    /*
     * The face is not a static ramp — it is water moving. Orbital motion carries it UP the
     * face, fastest near the lip and near the curl, and it falls away down in the trough.
     * That flow is why you can climb without dying, why the rail still bites when the board
     * itself is slow in the pocket, and why the fast line is mid-face rather than at the lip.
     */
    const faceFlow = P.waterUp * pw * sh.steep;
    const vUp = faceFlow * (this.u - P.liftZero) / (1 - P.liftZero);

    /*
     * SPEED THROUGH THE WATER, which is not the same as speed along the line.
     *
     * `spd` is velocity in the WAVE's frame — how fast you move across a face that is
     * itself travelling shoreward. Sitting still in that frame does not mean sitting still
     * in the water: you are being carried to the beach at the wave's own speed, planing
     * down a slope that regenerates under you. This is the rolling-downhill part, and it
     * is why trimming to match the peel leaves you with plenty of speed to turn on rather
     * than none. Everything hydrodynamic — lift, fin bite, turn radius, drag — runs off
     * this, while `spd` alone decides whether you gain or lose ground on the curl.
     */
    // Holding station on the curl means tracking a depth contour, which along the
    // SHORELINE is c / sin(crest angle) — real ground speed even when you are not gaining
    // an inch on the peel. That is the floor under your speed through the water.
    const carry = P.carryFrac * (sh.c / Math.max(0.30, Math.sin(sh.pa)))
      * (0.35 + 0.65 * sh.stand);
    this.vWater = Math.hypot(this.spd, carry);
    const vw = this.vWater;

    /* -- steering ---------------------------------------------------------
     * The pivot is the fins at the tail. Weight back loads them and the board swings;
     * weight forward puts you on the rail and draws the arc out long. Crucially the board
     * then HOLDS that line — gravity barely re-aims it, so where you point is where you go.
     */
    const grip = 1 / (1 + vw / P.turnSpdRef);
    // A rail carve is a radius: omega = g tan(lean) / v, so it slows down as you speed up.
    // A pivot off the buried fins is a rotation about the tail and barely cares about speed
    // — which is exactly why you drop your weight back to get the board round quickly.
    /*
     * A rail only bites if water is flowing over it. Crank a hard turn with no speed and
     * in real life you bog and fall in; here the authority simply is not there, so it
     * resolves itself without asking the player to manage yet another axis.
     */
    /*
     * Board geometry decides how much your stance is worth. A longer board draws wider
     * arcs; fins set further back give the tail more leverage, so stepping back swings it
     * harder. Fins forward is a looser, slidier board that neither holds nor drives as well.
     */
    const lenR = TUNE.boardLen / P.boardRefLen;
    const finLever = P.finLeverBase + P.finLeverGain * TUNE.finPos;

    /*
     * Stamping the tail (space) is the hard-turn input, but you can only push on a tail you
     * are standing near. Walk to the nose and there is no leverage left — the board just
     * keeps trimming. That coupling is the whole reason stance is a position you commit to.
     */
    const tailLev = clamp01(P.tailLevBase + P.tailLevGain * (P.tailLevPivot - this.w));
    this.tailPush = approach(this.tailPush, (input.tail || 0) * tailLev, 12, dt);

    const flow = clamp01((vw + faceFlow * 0.45) / P.railFlow);
    const carve = P.turnBase * (1 - P.turnDriveDamp * drive) * grip * (0.20 + 0.80 * flow) / lenR;
    // a longer board has more swing weight, so even a fins pivot comes round slower
    const pivot = P.turnPivot * this.tailPush * (0.35 + 0.65 * flow) * finLever / Math.sqrt(lenR);
    let dpsi = input.steer * (carve + pivot);
    // gravity nudges the nose downhill, but only in the normal riding range — past ~80 deg
    // this term would push you further into the reverse, which is not how a board behaves
    if (Math.abs(this.psi) < P.gravTurnTo) {
      dpsi -= P.gravTurn * Math.sin(beta) * Math.cos(this.psi) * clamp01(this.spd / 6);
    }
    this.turnRate = approach(this.turnRate, dpsi, 12, dt);
    /*
     * Heading is a real angle with no clamp. That matters: psi between 90 and 180 deg is
     * still CLIMBING while pointed back up the line, so a cutback only comes back down the
     * face once the arc carries past 180. Clamping short of that makes the manoeuvre
     * geometrically impossible. Holding the turn all the way round is a roundhouse, and it
     * pays for itself in rail drag.
     */
    this.psi = wrapPi(this.psi + this.turnRate * dt);

    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);

    /* -- longitudinal forces ---------------------------------------------
     * Push is purely positional: how close to the curl (pw), how high on the face
     * (faceBand), and how stood-up the wave actually is there (steep). Weight never adds
     * thrust — it only changes how much drag the board makes.
     */
    /*
     * Gravity pulls you down the face; the face itself is rising under you. High on the
     * wave the water lifts (climbing is cheap, which is how you reach the lip with speed
     * still on); down in the trough it drops away (which is what loads a bottom turn).
     */
    const lift = P.liftGain * vUp;
    const aGrav = (-P.G * TUNE.gravity * Math.sin(beta) + lift) * sp;

    const faceBand = Math.exp(-Math.pow((this.u - K.faceCenter) / K.faceWidth, 2));
    const shapePow = 1 - P.pushSteep + P.pushSteep * sh.steep;
    const aPush = P.push * pw * faceBand * shapePow;
    const aPump = P.pumpGain * drive * Math.max(0, -sp) * pw * faceBand;

    /*
     * Turning MAKES speed. Redirecting the board against the face is how a surfer generates
     * drive, and it goes as roughly the square of how hard you turn — so a long drawn carve
     * roughly holds what it has, while a hard committed turn pumps you up the line. It only
     * works where there is energy to redirect (in the pocket, on the face, with flow over
     * the rail), and it saturates, so you cannot just spin for free speed.
     */
    const om = Math.abs(this.turnRate);
    const bite = P.finBiteBase + P.finBiteGain * TUNE.finPos;   // loose tail generates less
    const aTurn = Math.min(P.turnDriveMax, TUNE.turnDrive * om * om * pw * faceBand * flow)
      * bite * clamp01(1 - vw / P.turnDriveCeil);

    /*
     * Weight forward levels the board and it planes; weight back sinks the tail. But
     * sinking the tail is only a BRAKE when you are going straight — do it mid-turn and
     * you are loading the fins, which is what drives the turn rather than what stops you.
     * Without this the brake fights the turn drive and a hard turn nets nothing.
     */
    /*
     * Trim. Where you stand sets the board's attack angle; speed sets the angle you
     * actually need to stay up. Drag is the mismatch, in both directions — dragging the
     * tail on one side, burying the nose on the other. There is no "more forward is always
     * faster", which is what made the stance feel overpowered.
     */
    const alpha = TUNE.trim - P.trimStance * this.w;
    const alphaReq = Math.sqrt(P.liftNeed / (Math.max(6, vw * vw) * lenR));
    this.alpha = alpha;
    this.trimErr = alpha - alphaReq;
    // where you'd have to be standing right now for a perfect trim — shown on the HUD so
    // the sweet spot is something you can read and chase, not guess at
    this.stanceOpt = clamp((TUNE.trim - alphaReq) / P.trimStance, -1, 1);
    const over = Math.max(0, this.trimErr) * (1 - P.trimTurnRelief * clamp01(om / 1.6));
    const under = Math.max(0, -this.trimErr);
    const plane = P.planeBase + P.trimOver * over + P.trimUnder * under * (1 + 4 * under);
    // stamping the tail digs the rail just as much as standing back on it does
    const dig = Math.max(brake, this.tailPush);
    const railBite = (P.railDrive + (P.railBrake - P.railDrive) * dig) * bite;
    // ...and more waterline also means it simply glides better
    const glide = P.dragLin * (1 - P.lenGlide * (lenR - 1));
    let aDrag = -plane * (glide * this.spd + P.dragQuad * vw * this.spd)
      - TUNE.railDrag * railBite * om * this.spd;
    if (this.u < P.flatsFrom) aDrag -= P.dragFlats * this.spd * (P.flatsFrom - this.u) * 12;

    this.spd = Math.max(0.4, this.spd + (aGrav + aPush + aPump + aTurn + aDrag) * dt);
    this.topSpd = Math.max(this.topSpd, this.vWater);

    /* -- integrate position ---------------------------------------------- */
    const ds = this.spd * cp * dt;
    this.s += ds;
    this.dist += Math.abs(ds);
    this.u += (this.spd * sp * dt) / Math.max(L, 0.5);

    /* -- the break point chases you --------------------------------------
     * How fast you are gaining on the curl, or losing to it. Board speed and progress down
     * the line are NOT the same thing — on a cutback you have plenty of speed while moving
     * backwards relative to the peel, and trimming so this reads zero is how you sit in
     * one spot in a barrel.
     */
    const peel = wave.peelAt(this.b);
    this.closing = this.spd * cp - peel;
    this.peel = peel;
    this.b += peel * dt;

    /* -- top and bottom of the face -------------------------------------- */
    const apex = colApexU();
    /*
     * There is headroom above the lip line. You need it: an off-the-top or the top half of
     * a cutback both carry you into the lip and back out, and gravity up there is steep
     * enough to throw you down again on its own. Only past the ceiling does it resolve.
     */
    if (this.u > P.uCeil) {
      // Only being deep, slow and under a throwing lip actually pitches you. Everything
      // else at the top of the face is a recoverable mistake — you stall and drop back in.
      const deep = this.d < 9 && sh.hollow > 0.4 && sh.stand > 0.6 && pw > 0.45;
      /*
       * How hard the lip is throwing right where you hit it. Meet a pitching lip at the
       * curl and it launches you — that is the whole timing of an air: you propel yourself
       * off the top and the lip throws you shoreward. Hit the same wave out on the soft
       * shoulder and there is nothing there to bounce off.
       */
      const thrown = pw * (0.35 + 0.65 * sh.hollow)
        * Math.exp(-Math.pow((this.d - WV.pitchAt) / (WV.pitchWidth * 1.6), 2));
      if (this.spd > P.airMin && sp > 0.08 && cp > 0 && sh.A > 0.8) {
        this.state = STATE.AIR;
        this.airT = 0;
        this.airVy = this.spd * sp * 0.55 + thrown * P.lipThrow;
        this.airOutV = thrown * P.lipOut + this.spd * 0.12;
        this.u = P.uCeil;
        this.psi = Math.min(this.psi, 0.55);
        this.push(thrown > 0.45 ? 'LAUNCHED' : 'AIR', 'air');
      } else if (deep && this.spd < 5.0) {
        this.state = STATE.WIPEOUT;
        this.endReason = 'OVER THE FALLS';
      } else if (sh.A < 0.9 || pw < 0.10) {
        this.state = STATE.KICKOUT;
        this.endReason = 'KICKED OUT OVER THE BACK';
      } else {
        /*
         * The lip deflects you back down the face. Negating psi flips the up-face component
         * while KEEPING the along-line one, so a turn that carried you to the top comes
         * back down still pointed the way you were going — which is precisely the second
         * half of an off-the-top or a cutback, rather than a reset.
         */
        this.u = P.uCeil - 0.02;
        this.psi = -this.psi;
        this.spd *= 0.90;
        this.push('OFF THE TOP', 'snap');
      }
    }
    // digging in below the trough: level the board out in whichever direction you are going
    if (this.u < P.uFloor) {
      this.u = P.uFloor;
      if (sp < 0) this.psi = wrapPi(this.psi + Math.min(1, -sp) * 3.2 * dt * (cp >= 0 ? 1 : -1));
    }

    /* -- in the tube ------------------------------------------------------ */
    // How far the lip has thrown past you, as a fraction of the wave's own height — an
    // absolute metre threshold never triggers on a small wave.
    const lip = colAt(1).run;
    const me = colAt(this.u).run;
    const inTube = sh.phi > 1.75 && this.u < apex && this.u > 0.18
      && lip < me - 0.10 * sh.A && pw > 0.25;
    if (inTube && !this.barreled) this.push('PITTED', 'tube');
    if (inTube) { this.barrelT += dt; this.sBarrel += S.barrelRate * dt * this.combo; }
    this.barreled = inTube;

    /* -- the foam ---------------------------------------------------------
     * Meeting the whitewater head-on off the back of a cutback is a manoeuvre, not a
     * death: the foam is moving down the line and it kicks you back out onto the face.
     * Drifting into it sideways or from behind is what drowns you.
     */
    this._bounceCd = Math.max(0, this._bounceCd - dt);
    if (this.d < K.foamEnter) {
      // "facing back up the line" has to be tested on the cosine — psi wraps, so a turn
      // carried past 180 deg comes out as a large NEGATIVE angle, not a large positive one
      if (cp < K.bounceCos && this.spd > K.bounceSpeed && this._bounceCd <= 0) {
        this.psi = -0.50;
        this.spd = clamp(this.spd * K.bounceKeep + K.bounceKick, 6.0, 14.0);
        this.u = Math.min(this.u + 0.15, 0.90);
        this.foamT = 0;
        this._bounceCd = K.bounceCool;
        this.sTurns += S.bounce * this.combo;
        this.combo = Math.min(S.comboMax, this.combo + 0.4);
        this.turnCount++;
        this.push('FOAM BOUNCE', 'bounce');
      } else {
        this.foamT += dt * (1 - 0.45 * drive * clamp01(this.spd / 12));
        if (this.foamT > K.foamGrace) {
          this.state = STATE.WIPEOUT;
          this.endReason = 'THE WAVE ATE YOU';
        }
      }
    } else {
      this.foamT = Math.max(0, this.foamT - dt * 1.8);
    }

    if (this.d > K.lostShoulder * sh.shoulder && this.spd < K.lostSpeed) {
      this.shoulderT += dt;
      if (this.shoulderT > 1.6) {
        this.state = STATE.KICKOUT;
        this.endReason = 'BOGGED ON THE SHOULDER';
      }
    } else this.shoulderT = 0;

    if (this.b > wave.endS + 90 || this.time > wave.duration * 1.8 + 20) {
      this.state = STATE.FINISHED;
      this.endReason = 'RODE IT TO THE SAND';
    }

    /* -- scoring ---------------------------------------------------------- */
    this._scoreTurns(dt);

    // holding a quiet, fast line in the pocket is the point of a Sunday midlength wave
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

    /* -- cosmetics -------------------------------------------------------- */
    this.lean = approach(this.lean, clamp(-this.turnRate * 0.55, -0.85, 0.85), 9, dt);
    this.crouch = approach(this.crouch, clamp01(brake * 0.8 + Math.abs(this.turnRate) * 0.35 + (1 - pw) * 0.1), 7, dt);
  }

  /** Reward a completed direction change: bigger swing + more speed kept = better. */
  _scoreTurns(dt) {
    // use the rate, not a difference of wrapped angles, or every wrap reads as a huge swing
    const dp = this.turnRate * dt;
    // how far round the arc got: |psi| near PI means fully reversed, pointing up the line
    this._swingPeak = Math.max(this._swingPeak, Math.abs(this.psi));
    const dir = Math.sign(dp);
    if (dir !== 0 && dir !== this._swingDir) {
      if (Math.abs(this._swing) > 0.62 && this.spd > 5) {
        const amp = Math.min(Math.abs(this._swing), 3.2);
        const fast = clamp01(this.spd / 15);
        const sharp = clamp01(Math.abs(this.turnRate) / 1.4);
        const back = this._swing > 0;
        // the arc carried past 90 deg, so you genuinely came around and pointed back up
        // the line at the curl. That is a cutback and nothing else.
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

  /** Airborne: a short arc over the lip, land clean or eat it. */
  stepAir(dt, input) {
    this.time += dt;
    this.airT += dt;
    this.airVy -= 9.81 * dt * 0.7;
    this.airY = Math.max(0, this.airY + this.airVy * dt);
    this.airOut += this.airOutV * dt;
    this.airOutV *= Math.max(0, 1 - 1.6 * dt);
    this.s += this.spd * Math.cos(this.psi) * dt;
    this.b += this.wave.peelAt(this.b) * dt;
    this.d = this.s - this.b;
    this.spd = Math.max(2, this.spd - 1.4 * dt);
    this.w = clamp(this.w + input.weight * P.stanceRate * dt, -1, 1);
    this.tailPush = approach(this.tailPush, 0, 6, dt);   // no fins in the water up here
    // rotate the nose back down so you can stick it
    this.psi = approach(this.psi, -0.55 + input.steer * 0.35, 2.4, dt);
    this.lean = approach(this.lean, input.steer * 0.6, 6, dt);

    if (this.airY <= 0.001 && this.airT > 0.12) {
      const clean = this.psi < 0.1 && this.spd > 6 && pocketPower(this.d, this._shoulder) > 0.15;
      if (clean) {
        const gain = 120 * clamp01(this.airT / 0.9) * this.combo;
        this.sTurns += gain;
        this.combo = Math.min(S.comboMax, this.combo + 0.5);
        this.push('STUCK IT', 'land');
        this.state = STATE.RIDING;
        this.u = 0.94;
        this.spd *= 0.86;
        this.airOut = 0; this.airOutV = 0;
      } else {
        this.state = STATE.WIPEOUT;
        this.endReason = 'BLEW THE LANDING';
      }
      this.airOut = Math.max(0, this.airOut);
    }
  }

  update(dt, input) {
    this.events.length = 0;
    if (this.state === STATE.AIR) this.stepAir(dt, input);
    else this.step(dt, input);
  }

  get alive() { return this.state === STATE.RIDING || this.state === STATE.AIR; }
}

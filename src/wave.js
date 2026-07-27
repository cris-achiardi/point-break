/**
 * The wave.
 *
 * The whole world lives in "wave coordinates":
 *   s = distance along the crest line, increasing down the line toward the shoulder
 *   u = height up the face, 0 at the trough, 1 at the lip tip
 *
 * Nothing here is a heightfield. Each station s has a *cross-section profile* built by
 * integrating a tangent angle beta(u) = phi * u^E from the trough up to the lip. When phi
 * pushes past 90 degrees the surface folds back over itself and you get a real barrel — no
 * special case needed, because the mesh is parametric rather than a y = f(x, z) surface.
 *
 * The break point b advances down the line at the local peel speed. Everything about the
 * game comes out of d = s - b:
 *      d < 0    you are behind the curl, in the foam
 *   0 < d < ~5  the pocket. steepest face, all the push.
 *      d > ~40  the shoulder. the swell has not stood up yet, so there is nothing to ride.
 */
import { CFG } from './config.js';
import { TUNE } from './tuning.js';
import { mulberry32, hash2, clamp, clamp01, lerp, smoothstep } from './rng.js';
import {
  Bathymetry, G, BREAKER, deepWavelength, iribarren, phiFromIribarren, refract, classify,
} from './bathymetry.js';

const W = CFG.wave;

/* ------------------------------------------------------------------ profile column
 * Module-scope scratch: call column(phi, A) for a station, then query colAt/colBeta for
 * as many rows as you like. Always re-call column() before switching station.
 */
const PN = 32;
const _run = new Float32Array(PN + 1);
const _ht = new Float32Array(PN + 1);
let _phi = 0;
let _L = 1;

/** Build the cross-section for one station. Returns arc length per unit u. */
export function column(phi, A) {
  _phi = phi;
  const dt = 1 / PN;
  let r = 0, h = 0;
  _run[0] = 0; _ht[0] = 0;
  for (let i = 1; i <= PN; i++) {
    const a = phi * Math.pow((i - 0.5) * dt, W.profE);
    r += Math.cos(a) * dt;
    h += Math.sin(a) * dt;
    _run[i] = r; _ht[i] = h;
  }
  // scale the arc so the lip lands exactly A metres above the trough
  _L = h > 1e-3 ? A / h : A * 2;
  for (let i = 0; i <= PN; i++) { _run[i] *= _L; _ht[i] *= _L; }
  return _L;
}

export const colL = () => _L;

/** Face tangent angle at height u — 0 is flat, PI/2 is a vertical wall, more is overhanging. */
export const colBeta = (u) => _phi * Math.pow(clamp01(u), W.profE);

/** u at which the face is exactly vertical; past this the lip is throwing over. */
export const colApexU = () =>
  _phi > Math.PI / 2 ? Math.pow(Math.PI / 2 / _phi, 1 / W.profE) : 1;

const _o = { run: 0, ht: 0 };
/** Position on the cross-section. run is metres seaward of the trough, ht is metres up. */
export function colAt(u) {
  if (u <= 0) { _o.run = u * _L * 3.0; _o.ht = 0; return _o; }   // flats, shoreward
  if (u >= 1) {                                                  // straight past the lip tip
    const e = (u - 1) * _L;
    _o.run = _run[PN] + Math.cos(_phi) * e;
    _o.ht = _ht[PN] + Math.sin(_phi) * e;
    return _o;
  }
  const f = u * PN, i = f | 0, k = f - i;
  _o.run = _run[i] + (_run[i + 1] - _run[i]) * k;
  _o.ht = _ht[i] + (_ht[i + 1] - _ht[i]) * k;
  return _o;
}

/* ------------------------------------------------------------------ sections */

const D = Math.PI / 180;

// How much of the point's contour turn shows up as actual bend in the crest line. The crest
// lags the contours badly (that is what leaves a peel angle at all), so it stays far
// straighter than the bottom underneath it.
const P_BEND = 0.30;

/**
 * The wave is DERIVED, not authored.
 *
 * Everything below reads the seabed (see bathymetry.js) and applies textbook coastal
 * engineering to it:
 *
 *   c    = sqrt(g d)                     shallow-water celerity — depth sets the speed
 *   H    = 0.78 d                        depth-saturated breaker — depth sets the size
 *   xi   = slope / sqrt(H / L0)          Iribarren number — the bottom sets the breaker
 *                                        type, and therefore how hollow the pocket is
 *   theta: sin(theta)/c conserved        Snell refraction — the crest swings toward
 *                                        parallel with the contours as it shoals
 *   peel = c / tan(theta + contour)      what is left between crest and contour is the
 *                                        peel angle, and that is the speed you race
 *
 * Note that size and speed are NOT independent any more, because in the ocean they are
 * not: a bigger wave breaks in deeper water and therefore travels faster. A slow wave is
 * bought with peel angle, not by slowing the whole ocean down.
 */

/**
 * Deep-water celerity for the swell: c0 = gT / 2pi.
 *
 * This has to come from the PERIOD, not from the local depth. Snell refraction compares the
 * shoaled celerity against deep water, and Iribarren already uses the period through
 * L0 = gT^2/2pi — deriving one from depth and the other from period meant the two halves of
 * the same swell disagreed, and the PERIOD slider moved breaker type without touching
 * refraction or peel at all.
 */
export const deepCelerity = () => (G * TUNE.period) / (2 * Math.PI);

const _shape = { A: 0, phi: 0, pa: 0, peel: 0, c: 5, xi: 0, depth: 3, L: 0, broken: 0, stand: 0, steep: 0, shoulder: 1, hollow: 0 };
const _peelTmp = { A: 0, phi: 0, pa: 0, peel: 0 };
const _labelTmp = { A: 0, phi: 0, pa: 0, peel: 0 };
const _bathTmp = { depth: 1, slope: 0.04, contour: 0 };
const _frame = { x: 0, z: 0, tx: 1, tz: 0, nx: 0, nz: -1 };

export class Wave {
  constructor(seed = 1) {
    this.seed = seed;
    this.bath = new Bathymetry(seed, 1);       // span is normalised; set after endS is known
    this._buildSections(seed);
    this._buildBaseline();
  }

  /**
   * Work out how long the point is, then hand the bathymetry that span.
   *
   * The wave lives until it has covered `length` metres of water shoreward, so the ride
   * lasts T = length / c. In that time the break runs along the crest at c / tan(peel
   * angle), so the along-crest distance is length * mean(1/tan). Both fall out of the
   * bottom — nothing here is a chosen number.
   */
  _buildSections() {
    // first pass: sample the bottom on a normalised span to get the mean geometry
    const L0 = deepWavelength(TUNE.period);
    const cDeep = deepCelerity();
    const b = {};
    let invTan = 0, cSum = 0;
    const N = 48;
    for (let i = 0; i < N; i++) {
      this.bath.sample((i + 0.5) / N, TUNE.depth, TUNE.slope, TUNE.wrap, b);
      const c = Math.sqrt(G * b.depth);
      const pa = this._peelAngle(c, cDeep, b.contour);
      invTan += 1 / Math.max(0.07, Math.tan(pa));
      cSum += c;
    }
    this.cMean = cSum / N;
    this.length = TUNE.length;
    this.duration = TUNE.length / this.cMean;
    this.endS = TUNE.length * (invTan / N);
    this.bath.span = this.endS;
    this.L0 = L0;
    this.cDeep = cDeep;
  }

  /** Crest-to-contour angle after refraction. This IS the peel angle. */
  _peelAngle(c, cDeep, contour) {
    const theta = refract(TUNE.swell, c, cDeep);
    return clamp((theta + contour) / TUNE.peel, 6 * D, 86 * D);
  }

  /**
   * The crest line in plan view.
   *
   * This must be driven by the CREST BEARING, which is not the peel angle. The peel angle
   * is crest-relative-to-contour and it jumps around with every reef feature; the crest
   * itself is a long, taut, almost straight line that only bends as it wraps the point.
   * Integrating a bearing means any wobble accumulates into position, so feeding the peel
   * angle in here made the wave snake. A real point break is close to straight, and this
   * is a single smooth monotonic bend across the whole ride.
   */
  _buildBaseline() {
    const s0 = -260, ds = 4, n = Math.ceil((this.endS + 420 - s0) / ds) + 1;
    const X = new Float32Array(n), Z = new Float32Array(n);
    const CS = new Float32Array(n), SN = new Float32Array(n);
    const bend = TUNE.wrap * P_BEND;
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) {
      const t = clamp01((s0 + i * ds) / this.endS);
      const g = bend * Math.pow(t, 1.3);
      const c = Math.cos(g), sn = Math.sin(g);
      X[i] = x; Z[i] = z; CS[i] = c; SN[i] = sn;
      x += c * ds; z += sn * ds;
    }
    this.bl = { s0, ds, n, X, Z, CS, SN };
  }

  /** Crest-line frame at s: origin (x,z), tangent (tx,tz), seaward normal (nx,nz). */
  frame(s, out = _frame) {
    const b = this.bl;
    const f = clamp((s - b.s0) / b.ds, 0, b.n - 1.001);
    const i = f | 0, k = f - i;
    out.x = b.X[i] + (b.X[i + 1] - b.X[i]) * k;
    out.z = b.Z[i] + (b.Z[i + 1] - b.Z[i]) * k;
    const c = b.CS[i] + (b.CS[i + 1] - b.CS[i]) * k;
    const sn = b.SN[i] + (b.SN[i + 1] - b.SN[i]) * k;
    out.tx = c; out.tz = sn;
    // Seaward, i.e. up the face. On a RIGHT-HANDER the lip sits to the rider's right as
    // they travel, so with the camera looking down +X this must resolve to +Z (screen
    // right). Flipping this sign also flips the handedness of the surface frame, so the
    // normal is cross(uface, t) rather than cross(t, uface).
    out.nx = -sn; out.nz = c;
    return out;
  }

  /** The wave's intrinsic shape at s, read straight off the seabed. */
  raw(s, out = {}) {
    const b = this.bath.sample(s, TUNE.depth, TUNE.slope, TUNE.wrap, _bathTmp);
    const c = Math.sqrt(G * b.depth);
    const H = BREAKER * b.depth;                       // depth-saturated breaker height
    const xi = iribarren(b.slope, H, this.L0);         // spilling vs plunging
    const pa = this._peelAngle(c, this.cDeep, b.contour);

    out.A = H;
    out.phi = phiFromIribarren(xi);
    out.pa = pa;
    out.peel = c / Math.max(0.07, Math.tan(pa));
    out.c = c;
    out.xi = xi;
    out.depth = b.depth;
    return out;
  }

  /**
   * What the wave is doing at s, as a human label. Read back off the derived numbers
   * rather than authored — a shallow steep ledge simply *is* a barrel section.
   */
  kindAt(s) {
    const r = this.raw(s, _labelTmp);
    return classify(r.xi, r.peel, r.A);
  }

  /**
   * The next place the wave's character changes within `look` metres. Scans forward and
   * reports the first station whose label differs from where you are now.
   */
  nextSection(s, look = 95) {
    const here = this.kindAt(s).label;
    for (let d = 12; d < look; d += 8) {
      const there = this.kindAt(s + d);
      if (there.label !== here) return { ...there, s: s + d };
    }
    return null;
  }

  /**
   * Full shape at station s given the break point b and time t.
   * This is where the swell stands up, the lip pitches, and the face collapses.
   */
  shape(s, b, t, out = _shape) {
    const r = this.raw(s, out);
    const d = s - b;

    /*
     * How much shoulder this wave has. A bigger wave carries more water and stands up
     * further ahead of the curl, and a slow oblique peel spreads the whole thing out — so
     * a big slow point gives you a long workable wall and time to draw turns, while a small
     * fast one compresses everything into the pocket. Every distance below scales with it.
     */
    const shoulder = clamp(
      Math.pow(r.A / W.shoulderRefA, 0.70) * Math.pow(r.peel / W.shoulderRefPeel, 0.60),
      W.shoulderMin, W.shoulderMax,
    );

    /*
     * Steepness is a function of how close you are to the curl. A wave is only vertical
     * where it is actually throwing; a few tens of metres down the line the same swell is
     * a rolling ramp. This gradient is the reason the pocket is worth chasing, so it is
     * modelled directly rather than bolted on as a bump.
     */
    const steep = W.steepShoulder + (1 - W.steepShoulder)
      * Math.exp(-Math.pow(Math.max(0, d - 2) / (W.steepFall * shoulder), 1.25));

    // and the swell has not stood up at all way out on the shoulder
    const stand = 1 - smoothstep(W.standNear * shoulder, W.standFar * shoulder, d);

    let A = r.A * lerp(W.standMinA, 1, stand);
    let phi = r.phi * steep * lerp(0.55, 1, stand);

    // ...and it all dies off past the end of the point
    const die = 1 - smoothstep(this.endS, this.endS + 150, s);
    A *= die; phi *= lerp(0.35, 1, die);

    // the lip pitches hardest right at the curl
    const hollow = clamp01((r.phi - 1.30) / 0.80);
    const pitch = Math.exp(-Math.pow((d - W.pitchAt) / W.pitchWidth, 2));
    phi += pitch * W.pitchGain * (0.35 + 0.65 * hollow) * stand;

    // behind the curl the face has already collapsed into whitewater
    const broken = clamp01(-(d + 1.0) / W.brokenOver);
    if (broken > 0) {
      phi = lerp(phi, W.brokenPhi, broken);
      A *= 1 - 0.46 * broken;
      A += Math.sin(s * 0.9 + t * 5.5) * W.brokenChop * broken;
    }

    out.A = Math.max(A, 0.02);
    out.phi = clamp(phi, 0.05, W.phiMax);
    out.peel = r.peel;
    out.broken = broken;
    out.stand = stand;
    out.steep = steep;
    out.shoulder = shoulder;
    out.hollow = hollow;
    return out;
  }

  /** Peel speed of the break point itself. */
  peelAt(b) {
    const r = this.raw(b, _peelTmp);
    // once the wave runs out of point the peel angle collapses and it slams shut
    const over = smoothstep(this.endS - 40, this.endS + 60, b);
    return lerp(r.peel, 24, over);
  }

  /**
   * World position at (s, u). Requires column() to have been called for this station.
   * Writes into a plain {x,y,z}.
   */
  pos(s, u, out) {
    const f = this.frame(s);
    const p = colAt(u);
    out.x = f.x + f.nx * p.run;
    out.y = p.ht;
    out.z = f.z + f.nz * p.run;
    return out;
  }
}

export { hash2 };

/**
 * What the current seabed settings actually produce, for the tuning readout. Sampled off
 * a real wave so the panel can never disagree with what you are riding.
 */
export function waveSummary(seed = 1) {
  const w = new Wave(seed);
  const r = {};
  let aMin = 1e9, aMax = -1e9, pMin = 1e9, pMax = -1e9, sMin = 1e9, sMax = -1e9;
  const N = 40;
  for (let i = 0; i < N; i++) {
    w.raw((i + 0.5) / N * w.endS, r);
    aMin = Math.min(aMin, r.A); aMax = Math.max(aMax, r.A);
    pMin = Math.min(pMin, r.phi); pMax = Math.max(pMax, r.phi);
    sMin = Math.min(sMin, r.peel); sMax = Math.max(sMax, r.peel);
  }
  return {
    aMin, aMax, sMin, sMax,
    pMin: pMin * 180 / Math.PI, pMax: pMax * 180 / Math.PI,
    dur: w.duration, along: w.endS, c: w.cMean,
  };
}

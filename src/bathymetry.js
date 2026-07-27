/**
 * The seabed. This is the actual input to the simulation — the wave is a consequence.
 *
 * A point break is a headland with a submerged spur running off it. Three things about the
 * bottom decide everything a surfer cares about:
 *
 *   depth   — how deep the water is where the wave trips. Sets BOTH the breaking height
 *             (H ~ 0.78 d, the saturated breaker index) and the wave's speed
 *             (c = sqrt(g d)). These are not independent: a bigger wave breaks deeper and
 *             therefore moves faster. You cannot ask for a big slow wave.
 *   slope   — the seabed gradient. Fed through the Iribarren surf-similarity number it
 *             decides breaker TYPE: gentle bottom spills and crumbles, steep bottom throws
 *             the lip forward and barrels. This is where hollowness comes from.
 *   contour — which way the depth contours run. Swell refracts toward shallow water
 *             (Snell's law, sin(theta)/c constant), so the crest swings as it wraps the
 *             point. The residual angle between crest and contour IS the peel angle, and
 *             a crest that fully aligns with the contours closes out.
 *
 * Sections are no longer authored. A shallow steep ledge simply *is* a barrel section; a
 * deep gentle patch *is* a fat section. The labels are read back off the numbers.
 */
import { mulberry32, clamp, clamp01, lerp, smoothstep } from './rng.js';

export const G = 9.81;
export const BREAKER = 0.78;      // H/d for a depth-saturated breaker
const D = Math.PI / 180;

/** Deep-water wavelength for a given swell period. L0 = g T^2 / 2pi */
export const deepWavelength = (period) => (G * period * period) / (2 * Math.PI);

/** Bottom features, as departures from the baseline depth and slope. */
const FEATURES = [
  // kind      depth offset   slope multiplier   contour swing
  { kind: 'ledge',   dz: -0.60, sm: 2.95, cs: -6 * D },   // shallow reef step -> throws
  { kind: 'bowl',    dz: -0.40, sm: 1.45, cs: -11 * D },  // shallow + contour swings in
  { kind: 'flat',    dz: +0.55, sm: 0.45, cs: +9 * D },   // deep gentle patch -> crumbles
  { kind: 'spur',    dz: -0.20, sm: 1.05, cs: -16 * D },  // ridge: contour turns hard
  { kind: 'channel', dz: +0.75, sm: 0.60, cs: +5 * D },   // deep -> the wave backs off
];

const _out = { depth: 1, slope: 0.04, contour: 0 };

export class Bathymetry {
  /** @param span metres of point to lay features along */
  constructor(seed, span) {
    const rnd = mulberry32(seed * 7919 + 13);
    this.span = span;
    this.feats = [];

    // guarantee the three bottom shapes that make the ride interesting, then fill
    const must = ['ledge', 'flat', 'bowl'];
    const pool = ['spur', 'flat', 'ledge', 'channel', 'bowl'];
    const order = [];
    for (let i = 0; i < 6; i++) order.push(i < must.length ? must[i] : pool[(rnd() * pool.length) | 0]);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }

    let at = 0.10;
    for (const kind of order) {
      const f = FEATURES.find((x) => x.kind === kind);
      this.feats.push({
        ...f,
        at: at + rnd() * 0.02,
        width: 0.095 + rnd() * 0.06,         // as a fraction of the span
        gain: 0.75 + rnd() * 0.5,
      });
      at += 0.135 + rnd() * 0.03;
    }
  }

  /**
   * Sample the bottom at along-point station s.
   * @param baseDepth metres of water over the reef on the open stretches
   * @param baseSlope seabed gradient there
   * @param wrap how hard the point's contours curve around the headland
   */
  sample(s, baseDepth, baseSlope, wrap, out = _out) {
    const t = clamp01(s / this.span);

    // the inside is progressively shallower as the wave runs up the point
    let depth = baseDepth * (1 - 0.30 * t);
    let slopeMul = 1;
    /*
     * Contour bearing. This is what actually makes a point break work, and it dominates
     * the residual refraction angle rather than correcting it: full Snell refraction pulls
     * a crest to within ~8 degrees of parallel with the contours, which is exactly why a
     * straight beach closes out. A headland's contours keep TURNING as the wave wraps, so
     * the crest can never catch up, and the angle it fails to close is the peel angle.
     */
    let contour = wrap * (0.55 + 0.45 * Math.pow(t, 1.2));

    for (const f of this.feats) {
      // a smooth bump, so the bottom is continuous and so is everything derived from it
      const g = Math.exp(-Math.pow((t - f.at) / f.width, 2)) * f.gain;
      if (g < 1e-3) continue;
      depth += f.dz * g;
      slopeMul += (f.sm - 1) * g;
      contour += f.cs * g;
    }

    out.depth = Math.max(0.35, depth);
    out.slope = Math.max(0.008, baseSlope * slopeMul);
    out.contour = contour;
    return out;
  }
}

/**
 * Breaker type from the Iribarren / surf-similarity number, xi = slope / sqrt(H/L0).
 * Below ~0.5 the wave spills and crumbles; 0.5-3.3 it plunges and throws a lip. That is
 * the whole spilling-vs-barrelling axis, and it comes from the bottom, not from the swell.
 */
export function iribarren(slope, H, L0) {
  return slope / Math.sqrt(Math.max(1e-4, H / L0));
}

/** Pocket steepness in radians, from the breaker type. */
export function phiFromIribarren(xi) {
  const plunge = smoothstep(0.35, 1.9, xi);
  return lerp(46 * D, 138 * D, plunge);
}

/**
 * Refraction. Snell's law for water waves: sin(theta)/c is conserved, so as the wave
 * shoals and slows its crest swings toward parallel with the depth contours.
 */
export function refract(swellAngle, c, cDeep) {
  return Math.asin(clamp(Math.sin(swellAngle) * (c / cDeep), -1, 1));
}

/** Read a human label back off the bottom, rather than authoring it. */
export function classify(xi, peel, H) {
  if (peel > 11) return { label: 'CLOSE OUT', tone: 'bad' };
  if (xi > 1.55 && peel > 3.2) return { label: 'BARREL', tone: 'tube' };
  if (peel > 6.5) return { label: 'FAST SECTION', tone: 'fast' };
  if (xi < 0.55) return { label: 'FAT SECTION', tone: 'fat' };
  if (xi > 1.2) return { label: 'BOWL', tone: 'fast' };
  return { label: 'OPEN WALL', tone: '' };
}

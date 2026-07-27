/**
 * Live tuning panel. Sliders write straight into TUNE, which the wave model and the rider
 * physics both read every frame, so the wall ahead of you and the feel under your feet
 * change as you drag. COPY puts a paste-ready block on the clipboard.
 */
import { TUNE, DEFAULTS, loadTune, saveTune, resetTune } from './tuning.js';
import { waveSummary } from './wave.js';
import { POV_AIM, netLeadDeg } from './render/camera.js';

const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;
const x2 = (v) => v.toFixed(2) + '×';

const ROWS = [
  { g: 'SEABED', key: 'depth', label: 'DEPTH', min: 1.20, max: 5.00, step: 0.02, fmt: (v) => v.toFixed(2) + ' m', rebuild: true },
  { g: 'SEABED', key: 'slope', label: 'SLOPE', min: 0.012, max: 0.140, step: 0.002, fmt: (v) => '1:' + (1 / v).toFixed(0), rebuild: true },
  /*
   * Clamped to the band that is actually a wave. Measured: below 46 deg the fast sections
   * peel over 11 m/s, which no board can make, and it degenerates into a closeout; above
   * 66 deg the slow sections drop under 1.4 m/s and the curl crawls. Both ends are
   * physically real — they are just not surfable.
   */
  { g: 'SEABED', key: 'wrap', label: 'POINT', min: 0.80, max: 1.15, step: 0.005, fmt: (v) => (v * 57.3).toFixed(0) + '°', rebuild: true },
  { g: 'SWELL', key: 'period', label: 'PERIOD', min: 6, max: 20, step: 0.5, fmt: (v) => v.toFixed(1) + ' s', rebuild: true },
  { g: 'SWELL', key: 'swell', label: 'ANGLE', min: 0.05, max: 0.80, step: 0.01, fmt: (v) => (v * 57.3).toFixed(0) + '°', rebuild: true },
  { g: 'SWELL', key: 'peel', label: 'PEEL TRIM', min: 0.55, max: 1.80, step: 0.01, fmt: (v) => v.toFixed(2) + '×', rebuild: true },
  { g: 'SWELL', key: 'peelScale', label: 'PEEL SPEED', min: 0.00, max: 1.50, step: 0.05, fmt: (v) => v < 0.05 ? 'closeout' : v.toFixed(2) + '×' },
  { g: 'SWELL', key: 'length', label: 'RUN', min: 120, max: 600, step: 5, fmt: (v) => v.toFixed(0) + ' m', rebuild: true },

  { g: 'BOARD', key: 'boardLen', label: 'LENGTH', min: 1.70, max: 3.00, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  { g: 'BOARD', key: 'finPos', label: 'FINS', min: 0, max: 1, step: 0.01, fmt: (v) => v < 0.34 ? 'forward' : v > 0.66 ? 'tail' : 'mid' },
  { g: 'BOARD', key: 'trim', label: 'TRIM', min: 0.02, max: 0.16, step: 0.002, fmt: (v) => (v * 57.3).toFixed(1) + '°' },
  { g: 'BOARD', key: 'gravity', label: 'GRAVITY', min: 0.50, max: 2.40, step: 0.01, fmt: x2 },
  { g: 'BOARD', key: 'turnDrive', label: 'TURN PUMP', min: 0.00, max: 3.00, step: 0.01, fmt: x2 },
  { g: 'BOARD', key: 'railDrag', label: 'RAIL DRAG', min: 0.00, max: 0.30, step: 0.005, fmt: (v) => v.toFixed(3) },

  /*
   * Camera placement. All of these are the mouth-mount POV except BACK/HIGH, which only move
   * the chase rig — press C to see what you are dragging. LOOK AHEAD reads out as the net
   * degrees the head gets ahead of the board on a hard snap, because the raw gain is not the
   * whole story: the yaw ease eats the first 0.20 of it (see camera.js).
   */
  { g: 'CAMERA', key: 'camEye', label: 'HEIGHT', min: 0.70, max: 1.90, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  // ceiling raised from 0.90 — the tuned default landed exactly on the old one, which is
  // usually a slider that ran out of room rather than a value someone chose
  { g: 'CAMERA', key: 'camAhead', label: 'FORWARD', min: -0.10, max: 1.60, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  { g: 'CAMERA', key: 'camSide', label: 'SIDEWAYS', min: -3.00, max: 3.00, step: 0.05, fmt: (v) => v.toFixed(2) + ' m' },
  { g: 'CAMERA', key: 'camPitch', label: 'TILT DOWN', min: 0.00, max: 0.70, step: 0.01, fmt: (v) => (v * DEG).toFixed(0) + '°' },
  { g: 'CAMERA', key: 'camFov', label: 'LENS', min: 40, max: 105, step: 1, fmt: lensFmt },
  { g: 'CAMERA', key: 'camWall', label: 'WALL', min: 0.00, max: 7.00, step: 0.10, fmt: (v) => (Math.atan2(v, POV_AIM) * DEG).toFixed(0) + '°' },
  { g: 'CAMERA', key: 'camLead', label: 'LOOK AHEAD', min: 0.00, max: 0.90, step: 0.01, fmt: leadFmt },
  { g: 'CAMERA', key: 'camRoll', label: 'LEAN IN', min: 0.00, max: 1.00, step: 0.01, fmt: (v) => v <= 0.005 ? 'level' : v.toFixed(2) + '×' },
  { g: 'CAMERA', key: 'camWalk', label: 'WALK', min: 0.00, max: 2.50, step: 0.05, fmt: (v) => v <= 0.005 ? 'off' : x2(v) },
  { g: 'CAMERA', key: 'camDuck', label: 'DUCK', min: 0.00, max: 0.60, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  { g: 'CAMERA', key: 'camDuckFwd', label: 'DUCK FWD', min: 0.00, max: 0.60, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  // floor lowered from 2.00 — the tuned default landed exactly on it, same as camAhead did
  { g: 'CAMERA', key: 'camBack', label: 'CHASE BACK', min: 1.00, max: 14.00, step: 0.1, fmt: (v) => v.toFixed(1) + ' m' },
  { g: 'CAMERA', key: 'camHigh', label: 'CHASE HIGH', min: 0.60, max: 7.00, step: 0.1, fmt: (v) => v.toFixed(1) + ' m' },
];

/**
 * Read out the NET lead on a hard snap, not the raw gain. The yaw ease is a first-order lag
 * that already sits behind the board, so it eats the bottom of the gain outright and low
 * settings honestly read 'none' — far less confusing than a slider that visibly moves while
 * nothing on screen changes. camera.js owns the arithmetic.
 */
function leadFmt(v) {
  const net = netLeadDeg(v);
  return net < 0.5 ? 'none' : net.toFixed(0) + '°';
}

/**
 * three.js measures fov VERTICALLY, which is not what anyone means by "wide" — on a 2.3:1
 * frame the horizontal angle is far larger. Tag the ends so the bare number does not get
 * read as a horizontal one.
 *
 * NB: a declaration, not a const arrow. ROWS above holds a direct reference to this, and
 * ROWS is evaluated at module load — a const would still be in its temporal dead zone at
 * that point and throw before the Tuner ever gets built. Same for leadFmt.
 */
function lensFmt(v) {
  return v.toFixed(0) + '°' + (v >= 88 ? ' wide' : v <= 52 ? ' tight' : '');
}

const CAM_KEYS = ROWS.filter((r) => r.g === 'CAMERA').map((r) => r.key);


const HINTS = {
  depth: 'water over the reef — sets wave SIZE and SPEED together (H=0.78d, c=sqrt(gd))',
  slope: 'seabed gradient — gentle crumbles, steep throws a barrel (Iribarren)',
  wrap: 'how hard the point turns — this is what stops it closing out',
  period: 'swell period — longer means more power and more barrel',
  swell: 'deep-water approach angle',
  peel: 'trim on the resulting peel angle',
  peelScale: 'how fast the curl runs down the line — 0 is a closeout you can take straight in',
  boardLen: 'longer glides and draws wider arcs',
  finPos: 'back = drivey and pivots hard, forward = loose',
  trim: 'nose-up angle at neutral stance — moves the sweet spot',
  gravity: 'speed the drop hands you',
  turnDrive: 'speed a hard turn makes',
  railDrag: 'what a carve costs',
  camEye: 'lens height above the board — 1.22 is the rider\'s own head',
  camAhead: 'how far the mount pokes out in front of the face',
  camSide: 'slide the lens right (+, toward the wall) or left — POV dollies, chase swings round',
  camPitch: 'nose-down tilt — this is what puts the board in shot, at the cost of the wall',
  camFov: 'lens angle, measured vertically. Wider pulls the board into frame on its own, '
    + 'so drop TILT DOWN as you open it up',
  camWall: 'how hard the view is turned into the face',
  camLead: 'how far the head looks ahead through a turn, so the board trails',
  camRoll: 'roll INTO the turn, as a fraction of the rider\'s own lean',
  camWalk: 'how much of the up/down stance walk the mount inherits — 1 is bolted to the head',
  camDuck: 'lens dropped by a full compression',
  camDuckFwd: 'lens thrown forward by it — keeps the rider\'s head behind the lens',
  camBack: 'chase only: distance behind the rider',
  camHigh: 'chase only: height above them',
};


/** What the current seabed actually produces. Sampled off a real wave, not guessed. */
function derive() {
  return waveSummary(1);
}

export class Tuner {
  constructor(onChange) {
    loadTune();
    this.onChange = onChange || (() => {});
    this.el = $('tuner');
    this.open = false;
    this.inputs = {};

    const body = $('tuner-rows');
    let group = null;
    for (const r of ROWS) {
      if (r.g !== group) {
        group = r.g;
        const h = document.createElement('div');
        h.className = 'tgroup';
        h.textContent = group;
        body.appendChild(h);
      }
      const row = document.createElement('label');
      row.className = 'trow';
      row.innerHTML = `<span class="tk">${r.label}</span>`
        + `<input type="range" min="${r.min}" max="${r.max}" step="${r.step}">`
        + `<b class="tv"></b>`;
      if (HINTS[r.key]) row.title = HINTS[r.key];
      const input = row.querySelector('input');
      const out = row.querySelector('b');
      input.value = TUNE[r.key];
      out.textContent = r.fmt(TUNE[r.key]);
      input.addEventListener('input', () => {
        TUNE[r.key] = parseFloat(input.value);
        out.textContent = r.fmt(TUNE[r.key]);
        saveTune();
        this.refresh();
        this.onChange(!!r.rebuild);
      });
      // keep arrow keys driving the board, not whichever slider has focus
      input.addEventListener('keydown', (e) => e.preventDefault());
      this.inputs[r.key] = { input, out, fmt: r.fmt };
      body.appendChild(row);
    }

    $('t-copy').addEventListener('click', () => this.copy());
    $('t-copy-cam').addEventListener('click', () => this.copy(this.camText(), 't-copy-cam'));
    $('t-reset').addEventListener('click', () => {
      resetTune();
      this.syncInputs();
      this.refresh();
      this.onChange(true);
      this.flash('RESET');
    });

    this.refresh();
  }

  syncInputs() {
    for (const r of ROWS) {
      const i = this.inputs[r.key];
      i.input.value = TUNE[r.key];
      i.out.textContent = i.fmt(TUNE[r.key]);
    }
  }

  refresh() {
    const d = derive();
    const row = (k, v) => `<div><span>${k}</span><span>${v}</span></div>`;
    $('t-derived').innerHTML =
      row('face', `${d.aMin.toFixed(1)}–${d.aMax.toFixed(1)} m`)
      + row('wave speed', `${d.c.toFixed(1)} m/s`)
      + row('pocket', `${d.pMin.toFixed(0)}–${d.pMax.toFixed(0)}°`)
      + row('peel', `${d.sMin.toFixed(1)}–${d.sMax.toFixed(1)} m/s`)
      + row('ride', `${d.dur.toFixed(0)} s · ${d.along.toFixed(0)} m`);
    $('t-default').style.display =
      Object.keys(DEFAULTS).every((k) => TUNE[k] === DEFAULTS[k]) ? 'none' : 'block';
  }

  text() {
    const d = derive();
    const pad = (s, n) => String(s).padEnd(n);
    return [
      'WAVE SETTINGS',
      `  ${pad('depth', 10)}${TUNE.depth.toFixed(2)} m     -> face   ${d.aMin.toFixed(1)}-${d.aMax.toFixed(1)} m, c ${d.c.toFixed(1)} m/s`,
      `  ${pad('slope', 10)}1:${(1 / TUNE.slope).toFixed(0).padEnd(5)} -> pocket ${d.pMin.toFixed(0)}-${d.pMax.toFixed(0)} deg`,
      `  ${pad('wrap', 10)}${(TUNE.wrap * 57.3).toFixed(0)} deg    -> peel   ${d.sMin.toFixed(1)}-${d.sMax.toFixed(1)} m/s`,
      `  ${pad('period', 10)}${TUNE.period.toFixed(1)} s`,
      `  ${pad('swell', 10)}${(TUNE.swell * 57.3).toFixed(0)} deg`,
      `  ${pad('peel', 10)}${TUNE.peel.toFixed(2)}x`,
      `  ${pad('length', 10)}${TUNE.length.toFixed(0)} m     -> ride   ${d.dur.toFixed(0)} s over ${d.along.toFixed(0)} m`,
      'BOARD',
      `  ${pad('boardLen', 10)}${TUNE.boardLen.toFixed(2)} m`,
      `  ${pad('finPos', 10)}${TUNE.finPos.toFixed(2)}`,
      `  ${pad('trim', 10)}${(TUNE.trim*57.3).toFixed(1)} deg`,
      `  ${pad('gravity', 10)}${TUNE.gravity.toFixed(2)}x`,
      `  ${pad('turnDrive', 10)}${TUNE.turnDrive.toFixed(2)}x`,
      `  ${pad('railDrag', 10)}${TUNE.railDrag.toFixed(3)}`,
      '',
      JSON.stringify(Object.fromEntries(
        Object.keys(DEFAULTS).map((k) => [k, +TUNE[k].toFixed(3)]))),
    ].join('\n');
  }

  /** Just the camera placement, so it can be pasted back over the block in tuning.js. */
  camText() {
    const pad = (s) => String(s).padEnd(12);   // 12, not 10 — 'camDuckFwd' is 10 on the nose
                                               // and ran straight into its own value
    const net = netLeadDeg(TUNE.camLead);
    return [
      'CAMERA  (mouth-mount POV)',
      `  ${pad('camEye')}${TUNE.camEye.toFixed(2)} m`,
      `  ${pad('camAhead')}${TUNE.camAhead.toFixed(2)} m`,
      `  ${pad('camSide')}${TUNE.camSide.toFixed(2)} m`,
      `  ${pad('camPitch')}${TUNE.camPitch.toFixed(2)} rad -> ${(TUNE.camPitch * DEG).toFixed(0)} deg nose-down`,
      `  ${pad('camFov')}${TUNE.camFov.toFixed(0)}       -> deg vertical, before the speed stretch`,
      `  ${pad('camWall')}${TUNE.camWall.toFixed(2)} m   -> ${(Math.atan2(TUNE.camWall, POV_AIM) * DEG).toFixed(0)} deg toward the face`,
      `  ${pad('camRoll')}${TUNE.camRoll.toFixed(2)}x    -> of the rider's own lean, into the turn`,
      `  ${pad('camWalk')}${TUNE.camWalk.toFixed(2)}x    -> of the stance walk`,
      `  ${pad('camDuck')}${TUNE.camDuck.toFixed(2)} m`,
      `  ${pad('camDuckFwd')}${TUNE.camDuckFwd.toFixed(2)} m`,
      `  ${pad('camLead')}${TUNE.camLead.toFixed(2)}     -> ${net < 0.5 ? 'no lead' : net.toFixed(0) + ' deg lead'} on a snap`,
      'CAMERA  (chase)',
      `  ${pad('camBack')}${TUNE.camBack.toFixed(1)} m`,
      `  ${pad('camHigh')}${TUNE.camHigh.toFixed(1)} m`,
      '',
      JSON.stringify(Object.fromEntries(CAM_KEYS.map((k) => [k, +TUNE[k].toFixed(3)]))),
    ].join('\n');
  }

  async copy(text, btn = 't-copy') {
    const t = text || this.text();
    try {
      await navigator.clipboard.writeText(t);
      this.flash('COPIED', btn);
    } catch {
      // the clipboard API needs a secure context; fall back to a selectable textarea
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;top:-1000px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      this.flash(ok ? 'COPIED' : 'COPY FAILED', btn);
    }
  }

  flash(msg, btn = 't-copy') {
    const b = $(btn);
    const old = b.dataset.label || b.textContent;
    b.dataset.label = old;
    b.textContent = msg;
    clearTimeout(this._ft);
    this._ft = setTimeout(() => { b.textContent = old; }, 1100);
  }

  toggle() {
    this.open = !this.open;
    this.el.classList.toggle('on', this.open);
    if (!this.open) document.activeElement?.blur?.();
  }
}

/**
 * Live tuning panel. Sliders write straight into TUNE, which the wave model and the rider
 * physics both read every frame, so the wall ahead of you and the feel under your feet
 * change as you drag. COPY puts a paste-ready block on the clipboard.
 */
import { TUNE, DEFAULTS, loadTune, saveTune, resetTune } from './tuning.js';
import { waveSummary } from './wave.js';

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
  { g: 'SWELL', key: 'length', label: 'RUN', min: 120, max: 600, step: 5, fmt: (v) => v.toFixed(0) + ' m', rebuild: true },

  { g: 'BOARD', key: 'boardLen', label: 'LENGTH', min: 1.70, max: 3.00, step: 0.01, fmt: (v) => v.toFixed(2) + ' m' },
  { g: 'BOARD', key: 'finPos', label: 'FINS', min: 0, max: 1, step: 0.01, fmt: (v) => v < 0.34 ? 'forward' : v > 0.66 ? 'tail' : 'mid' },
  { g: 'BOARD', key: 'trim', label: 'TRIM', min: 0.02, max: 0.16, step: 0.002, fmt: (v) => (v * 57.3).toFixed(1) + '°' },
  { g: 'BOARD', key: 'gravity', label: 'GRAVITY', min: 0.50, max: 2.40, step: 0.01, fmt: x2 },
  { g: 'BOARD', key: 'turnDrive', label: 'TURN PUMP', min: 0.00, max: 3.00, step: 0.01, fmt: x2 },
  { g: 'BOARD', key: 'railDrag', label: 'RAIL DRAG', min: 0.00, max: 0.30, step: 0.005, fmt: (v) => v.toFixed(3) },
];


const HINTS = {
  depth: 'water over the reef — sets wave SIZE and SPEED together (H=0.78d, c=sqrt(gd))',
  slope: 'seabed gradient — gentle crumbles, steep throws a barrel (Iribarren)',
  wrap: 'how hard the point turns — this is what stops it closing out',
  period: 'swell period — longer means more power and more barrel',
  swell: 'deep-water approach angle',
  peel: 'trim on the resulting peel angle',
  boardLen: 'longer glides and draws wider arcs',
  finPos: 'back = drivey and pivots hard, forward = loose',
  trim: 'nose-up angle at neutral stance — moves the sweet spot',
  gravity: 'speed the drop hands you',
  turnDrive: 'speed a hard turn makes',
  railDrag: 'what a carve costs',
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

  async copy() {
    const t = this.text();
    try {
      await navigator.clipboard.writeText(t);
      this.flash('COPIED');
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
      this.flash(ok ? 'COPIED' : 'COPY FAILED');
    }
  }

  flash(msg) {
    const b = $('t-copy');
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

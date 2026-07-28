/**
 * Touch controls: two analog thumbsticks, three action buttons, three meta buttons.
 *
 * The sticks are the point of this. A keyboard can only ever say steer = -1, 0 or +1, but
 * `surfer.step` uses steer as a MULTIPLIER on the carve (dpsi = steer * (carve + pivot)) and
 * weight as a multiplier on the stance rate — so a fractional axis buys real precision the
 * keyboard cannot express: a quarter-turn to hold a high line, a lazy drift down off the lip, a
 * stance nudged a few centimetres rather than walked to the stop.
 *
 * Nothing here duplicates the double-tap logic in Input. The buttons call input.arm(act) and let
 * Input's own `_armed` flags carry the gesture to the physics, so a snap fired from the COMP
 * button and one from a keyboard double-tap are the same event downstream.
 *
 * Axes are reported through apply() rather than written to Input.down, because that Set is
 * binary by nature — a stick that only ever produced 0 or 1 would throw away the whole reason
 * for having a stick.
 */
import { TUNE } from './tuning.js';
import { clamp } from './rng.js';

/*
 * Is this a touch-first device?
 *
 * Feature query, not a UA sniff. `pointer: coarse` is true when the PRIMARY pointer is a finger,
 * which covers phones and tablets (iPadOS included, where the UA string claims to be a Mac)
 * while correctly excluding a touchscreen laptop, whose primary pointer is still its trackpad.
 * `hover: none` is the belt to that braces: a device that cannot hover cannot be driven by a
 * mouse.
 *
 * ?touch=1 / ?touch=0 forces it either way, which is how you test the pads on a desktop.
 */
export function isTouchDevice() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return matchMedia('(pointer: coarse) and (hover: none)').matches;
}

/* ------------------------------------------------------------------ icons
 * Hand-placed pixel art on a 12x12 grid, emitted as one <rect> per lit pixel. Deliberately not
 * smooth vector shapes: the whole game renders through a 320x240 posterise pass, so a control
 * layer drawn with anti-aliased curves would be the only soft thing on screen.
 *
 * These are placeholders to be replaced with real assets. Anything that reads back as a 12x12
 * grid of squares will drop straight in — keep the viewBox and swap the rows.
 */
const ICONS = {
  // arrows squeezing inward: a compression
  comp: [
    '....####....',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '............',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '....####....',
  ],
  // stacked chevrons: extend, and again, and again
  pump: [
    '............',
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '............',
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '............',
    '............',
  ],
  // driving down onto a floor: weight back, tail bogged
  brake: [
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '.##########.',
    '.##########.',
    '............',
  ],
  cam: [
    '............',
    '....###.....',
    '...#####....',
    '.##########.',
    '.##########.',
    '.###....###.',
    '.##.####.##.',
    '.###....###.',
    '.##########.',
    '.##########.',
    '............',
    '............',
  ],
  snd: [
    '............',
    '......#.....',
    '.....##..#..',
    '..####..#.#.',
    '..####..#.#.',
    '..####..#.#.',
    '..####..#.#.',
    '.....##..#..',
    '......#.....',
    '............',
    '............',
    '............',
  ],
  mute: [
    '............',
    '......#.....',
    '.....##.....',
    '..####..#..#',
    '..####...##.',
    '..####...##.',
    '..####..#..#',
    '.....##.....',
    '......#.....',
    '............',
    '............',
    '............',
  ],
  pause: [
    '............',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '..###..###..',
    '............',
    '............',
  ],
  play: [
    '............',
    '...#........',
    '...##.......',
    '...###......',
    '...####.....',
    '...#####....',
    '...#####....',
    '...####.....',
    '...###......',
    '...##.......',
    '...#........',
    '............',
  ],
  turn: [
    '............',
    '............',
    '............',
    '..#......#..',
    '.##......##.',
    '###########.',
    '###########.',
    '.##......##.',
    '..#......#..',
    '............',
    '............',
    '............',
  ],
  walk: [
    '.....##.....',
    '....####....',
    '...######...',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
  ],
};

/** One <rect> per lit pixel. Runs of pixels merge into a single rect to keep the node count down. */
function icon(name) {
  const rows = ICONS[name];
  let r = '';
  for (let y = 0; y < rows.length; y++) {
    let x = 0;
    while (x < rows[y].length) {
      if (rows[y][x] !== '#') { x++; continue; }
      let w = 1;
      while (rows[y][x + w] === '#') w++;
      r += `<rect x="${x}" y="${y}" width="${w}" height="1"/>`;
      x += w;
    }
  }
  return `<svg class="ico" viewBox="0 0 12 12" aria-hidden="true">${r}</svg>`;
}

/*
 * Dead zone, then RENORMALISE so the live band still spans a full 0..1 — without the second step
 * every axis would top out at 1 - DEAD and you could never reach a full-lock turn.
 *
 * A true zero at rest is not cosmetic. surfer.js gates a snap on `steer !== 0`, so drift would
 * arm snaps you never asked for.
 */
const DEAD = 0.16;
function axis(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
}

/** Travel from stick centre to full deflection, in px. */
const REACH = 42;

export class TouchControls {
  /**
   * @param {Input} input the keyboard Input, whose arm() we borrow for the gestures
   * @param {(code:string)=>void} onKey the same channel the keyboard uses, for the meta buttons
   */
  constructor(input, onKey) {
    this.input = input;
    this.onKey = onKey || (() => {});

    this.turn = 0;        // -1 down the face .. +1 up toward the lip
    this.walk = 0;        // -1 tail .. +1 nose
    this.compress = 0;    // held tail stamp
    this.braking = false;

    this._lastComp = -1e9;   // for the double-tap that becomes a snap
    this._pointers = new Map();

    this.root = document.getElementById('touch');
    if (!this.root) return;
    this.root.innerHTML = `
      <div class="tmeta">
        <button class="tmbtn" data-meta="KeyC">${icon('cam')}</button>
        <button class="tmbtn" data-meta="KeyM">${icon('snd')}${icon('mute')}</button>
        <button class="tmbtn" data-meta="KeyP">${icon('pause')}${icon('play')}</button>
      </div>
      <div class="tstick tturn" data-stick="turn">
        <i class="ttrack h"></i><b class="tknob"></b>
        <u>${icon('turn')}<span>TURN</span></u>
      </div>
      <div class="tbuttons">
        <button class="tpad" data-btn="pump">${icon('pump')}<span>PUMP</span></button>
        <button class="tpad" data-btn="comp">${icon('comp')}<span>COMP</span></button>
        <button class="tpad" data-btn="brake">${icon('brake')}<span>BRAKE</span></button>
      </div>
      <div class="tstick twalk" data-stick="walk">
        <i class="ttrack v"></i><b class="tknob"></b>
        <u>${icon('walk')}<span>WALK</span></u>
      </div>`;

    for (const el of this.root.querySelectorAll('[data-stick]')) this._bindStick(el);
    for (const el of this.root.querySelectorAll('[data-btn]')) this._bindButton(el);
    for (const el of this.root.querySelectorAll('[data-meta]')) this._bindMeta(el);

    // A finger that leaves the page, or a tab that goes away mid-ride, must not leave an axis or
    // a held button latched on — same reason Input resets itself on blur.
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  show(on) { this.root?.classList.toggle('on', !!on); }

  releaseAll() {
    this.turn = 0;
    this.walk = 0;
    this.compress = 0;
    this.braking = false;
    this._pointers.clear();
    for (const k of this.root?.querySelectorAll('.tknob') || []) k.style.transform = '';
    for (const b of this.root?.querySelectorAll('.tpad') || []) b.classList.remove('down');
  }

  /*
   * Sticks use a FLOATING origin: the centre is wherever the finger first landed, not the middle
   * of the pad. On a screen you cannot feel, an absolute origin means every grab starts with a
   * jerk as the axis snaps to wherever your thumb happened to touch down.
   */
  _bindStick(el) {
    const which = el.dataset.stick;
    const knob = el.querySelector('.tknob');
    const vertical = which === 'walk';

    const move = (e, o) => {
      const dx = e.clientX - o.x, dy = e.clientY - o.y;
      // each stick is single-axis: turn reads left/right, walk reads up/down. Constraining them
      // keeps a diagonal thumb from bleeding steer into stance and vice versa.
      const raw = clamp((vertical ? -dy : dx) / REACH, -1, 1);
      const v = axis(raw);
      if (vertical) this.walk = v; else this.turn = v;
      const px = vertical ? 0 : raw * REACH;
      const py = vertical ? -raw * REACH : 0;
      knob.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    };

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const o = { x: e.clientX, y: e.clientY };
      this._pointers.set(e.pointerId, o);
      el.classList.add('down');
      move(e, o);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      const o = this._pointers.get(e.pointerId);
      if (o) { move(e, o); e.preventDefault(); }
    });
    const end = (e) => {
      if (!this._pointers.delete(e.pointerId)) return;
      if (vertical) this.walk = 0; else this.turn = 0;
      knob.style.transform = '';
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _bindButton(el) {
    const which = el.dataset.btn;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      e.preventDefault();

      if (which === 'comp') {
        this.compress = 1;
        /*
         * Second tap inside the same window the keyboard uses is a snap. Reusing TUNE.snapWindow
         * rather than a touch-specific constant means retuning the feel in the tuner moves both
         * input paths together.
         */
        const now = performance.now() / 1000;
        if (now - this._lastComp < TUNE.snapWindow) {
          this.input.arm('tail');
          this._lastComp = -1e9;      // consumed; a third tap starts a fresh pair
        } else {
          this._lastComp = now;
        }
      } else if (which === 'pump') {
        // A dedicated button does not need a double-tap to disambiguate, so one press is one
        // pump. surfer.js still gates it on pumpCool and on actually being on the face, and
        // chaining them in rhythm is what builds the link multiplier.
        this.input.arm('up');
      } else if (which === 'brake') {
        /*
         * Set the brake and hold it. Crucially it does NOT touch the stance: how hard you slow
         * is decided by where the walk stick has put you. This is the one place touch is
         * strictly better than the keyboard, where holding the brake and walking backward are
         * unavoidably the same key.
         */
        this.input.arm('down');
        this.braking = true;
      }
    });

    const end = (e) => {
      el.classList.remove('down');
      if (which === 'comp') this.compress = 0;
      if (which === 'brake') this.braking = false;
      e.preventDefault();
    };
    /*
     * pointerup and pointercancel only. Not pointerleave: BRAKE and COMP are held, and a thumb
     * that drifts a pixel off the edge of a button it is holding must not release it. Capture
     * means the element keeps receiving events wherever the finger goes, so these two are the
     * complete set.
     */
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /*
   * Camera, mute and pause. These are pure pass-throughs to the keyboard's own handler, so the
   * button and the key cannot drift apart.
   *
   * `.alt` swaps which of the two stacked icons shows. Toggling it locally is safe because on a
   * touch-first device the button is the only thing that can change these — there is no keyboard
   * to fall out of sync with.
   */
  _bindMeta(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onKey(el.dataset.meta);
      if (el.dataset.meta !== 'KeyC') el.classList.toggle('alt');
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 110);
    });
  }

  /**
   * Fold the touch state into the sampled input. Called from Input.sample().
   *
   * Touch only OVERRIDES where it is actually live, so a hybrid device (or a desktop with
   * ?touch=1) can still drive the same ride from the keyboard between thumb presses.
   */
  apply(inp) {
    if (this.turn !== 0) inp.steer = this.turn;
    if (this.walk !== 0) inp.weight = this.walk;
    if (this.compress) inp.tail = 1;
    // the brake rides its own channel, so it leaves the walk stick alone
    if (this.braking) inp.brake = 1;
  }
}

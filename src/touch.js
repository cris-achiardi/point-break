/**
 * Touch controls: one analog thumbstick, three action buttons, a board-position pair, three meta
 * buttons. Laid out and drawn from the Figma file — see sprites.js for the art itself.
 *
 * THE STICK IS STILL ANALOG, and has to be. `surfer.step` uses steer as a MULTIPLIER on the carve
 * (dpsi = steer * (carve + pivot)), applied instantaneously, so a fractional axis buys precision
 * the keyboard cannot express: a quarter-turn held to keep a high line, a lazy drift down off the
 * lip. Quantising steer to -1/0/+1 would throw that away. What IS quantised is the picture — the
 * thumb sprite snaps to whole art blocks — because a sub-block offset would land the puck on
 * fractional pixels and resample it into mush. Continuous input, blocky feedback.
 *
 * BOARD POSITION IS TWO BUTTONS, and that costs almost nothing, which is worth spelling out
 * because it looks like the same downgrade. It is not: weight is a RATE, integrated into a stance
 * (surfer.js — `this.w = clamp(this.w + input.weight * P.stanceRate * dt, -1, 1)`). The stance you
 * end up at is set by how LONG you hold, so it stays fully continuous with a plain button. The
 * only thing an axis bought here was how fast you walk, and you trim far less often than you
 * carve — hence the smaller, less prominent control.
 *
 * Nothing here duplicates the double-tap logic in Input. The buttons call input.arm(act) and let
 * Input's own `_armed` flags carry the gesture to the physics, so a snap fired from the COMP
 * button and one from a keyboard double-tap are the same event downstream.
 *
 * Axes are reported through apply() rather than written to Input.down, because that Set is
 * binary by nature and steer is not.
 */
import { TUNE } from './tuning.js';
import { clamp } from './rng.js';
import { spriteUrl, spriteSize } from './sprites.js';

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
 * These are the META buttons only — camera, sound, pause, restart. The gameplay controls were
 * drawn this way too until the real art landed (see sprites.js). The chrome along the top edge has
 * no design yet, so it keeps the hand-placed icons and the extruded-CSS look that goes with them.
 */
const ICONS = {
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
  // double chevron back: rewind, i.e. take it from the top
  restart: [
    '............',
    '............',
    '.....#....#.',
    '....##...##.',
    '...###..###.',
    '..####.####.',
    '..####.####.',
    '...###..###.',
    '....##...##.',
    '.....#....#.',
    '............',
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

/** Travel of the FINGER from where it landed to a full-lock axis, in px. */
const REACH = 42;

/**
 * Travel of the THUMB SPRITE at full lock, in whole art blocks.
 *
 * Three, and not a free choice: the thumb is 13 blocks wide over an 11-block hole, so three blocks
 * of slide uncovers two blocks of socket and makes the composite fifteen blocks wide — the exact
 * width of the baked stick-left / stick-right art this replaced. It also gives seven distinct
 * positions to read instead of the three that art could show.
 */
const TRAVEL = 3;

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
    this._held = { nose: false, tail: false };

    this.root = document.getElementById('touch');
    if (!this.root) return;
    /*
     * The layout is the Figma mock, and the cluster on the right is positioned as a DIAMOND around
     * compress rather than as a stack: compress is the biggest block and sits nearest the thumb
     * because it is the button you hit most, pump and brake are smaller and flank it, and board
     * position sits furthest inboard because you touch it least. No text labels — the icons carry
     * it now, and the labels were the first thing to become unreadable at phone size.
     */
    this.root.innerHTML = `
      <div class="tmeta left">
        <button class="tmbtn" data-meta="KeyR">${icon('restart')}</button>
      </div>
      <div class="tmeta">
        <button class="tmbtn" data-meta="KeyC">${icon('cam')}</button>
        <button class="tmbtn" data-meta="KeyM" data-toggle>${icon('snd')}${icon('mute')}</button>
        <button class="tmbtn" data-meta="KeyP" data-toggle>${icon('pause')}${icon('play')}</button>
      </div>
      <div class="tstick" data-stick="turn" aria-label="turn">
        <i class="thole"></i><b class="tthumb"></b>
      </div>
      <div class="tcluster">
        <div class="tpill" data-pill>
          <button class="tzone up" data-walk="nose" aria-label="walk toward the nose"></button>
          <button class="tzone dn" data-walk="tail" aria-label="walk toward the tail"></button>
        </div>
        <button class="tpad comp" data-btn="comp" aria-label="compress"></button>
        <button class="tpad pump" data-btn="pump" aria-label="pump"></button>
        <button class="tpad brake" data-btn="brake" aria-label="brake"></button>
      </div>`;

    this._paint();

    for (const el of this.root.querySelectorAll('[data-stick]')) this._bindStick(el);
    for (const el of this.root.querySelectorAll('[data-btn]')) this._bindButton(el);
    for (const el of this.root.querySelectorAll('[data-pill]')) this._bindPill(el);
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
    this._held.nose = this._held.tail = false;
    for (const t of this.root?.querySelectorAll('.tthumb') || []) t.style.setProperty('--tx', '0');
    for (const b of this.root?.querySelectorAll('.tpad') || []) b.classList.remove('down');
    for (const p of this.root?.querySelectorAll('.tpill') || []) p.classList.remove('nose', 'tail');
  }

  /*
   * Hand the art to CSS.
   *
   * Every control gets its sprite as a --spr* custom property and its SIZE IN ART BLOCKS as --w
   * and --h. CSS multiplies those block counts by whichever scale the control belongs to, so
   * nothing in here knows how many CSS pixels a block is worth on the current screen — which is
   * exactly what lets a media query rescale the whole control layer by editing two numbers.
   *
   * --hd (and --hu on the pill) is the PRESSED height, one block shorter, because the extruded
   * skirt collapses when a block is pushed in. CSS anchors these backgrounds to the BOTTOM so the
   * missing block comes off the top and the block sinks; anchored any other way it looks like the
   * ground rose instead.
   */
  _paint() {
    const url = (n) => `url("${spriteUrl(n)}")`;
    const set = (el, props) => {
      if (!el) return;
      for (const [k, v] of Object.entries(props)) el.style.setProperty(k, String(v));
    };

    for (const [sel, rest, down] of [
      ['.tpad.comp', 'comp', 'compDown'],
      ['.tpad.pump', 'pump', 'pumpDown'],
      ['.tpad.brake', 'brake', 'brakeDown'],
    ]) {
      const s = spriteSize(rest);
      set(this.root.querySelector(sel), {
        '--spr': url(rest),
        '--sprDown': url(down),
        '--w': s.cols,
        '--h': s.rows,
        '--hd': spriteSize(down).rows,
      });
    }

    const pill = spriteSize('walk');
    set(this.root.querySelector('.tpill'), {
      '--spr': url('walk'),
      '--sprUp': url('walkUp'),
      '--sprDn': url('walkDn'),
      '--w': pill.cols,
      '--h': pill.rows,
      '--hu': spriteSize('walkUp').rows,
      '--hd': spriteSize('walkDn').rows,
      // the divider is a solid run of outline across art row 9, and the halves either side of it
      // are NOT equal — the lower one carries the two-block skirt, so it is eleven rows to the
      // upper one's nine. Split the hit area on the divider, where the eye already puts it.
      '--split': 10,
    });

    const thumb = spriteSize('thumb'), hole = spriteSize('hole');
    set(this.root.querySelector('.tstick'), {
      '--travel': TRAVEL,
      '--tw': thumb.cols,
      '--th': thumb.rows,
      '--hw': hole.cols,
      '--hh': hole.rows,
    });
    set(this.root.querySelector('.tthumb'), { '--spr': url('thumb') });
    set(this.root.querySelector('.thole'), { '--spr': url('hole') });
  }

  /*
   * The stick uses a FLOATING origin: the centre is wherever the finger first landed, not the
   * middle of the pad. On a screen you cannot feel, an absolute origin means every grab starts
   * with a jerk as the axis snaps to wherever your thumb happened to touch down.
   */
  _bindStick(el) {
    const thumb = el.querySelector('.tthumb');

    const move = (e, o) => {
      // Horizontal only, and the art agrees: the thumb rides in a slot and the socket behind it
      // can only ever show on the left or the right. Ignoring dy also stops a thumb that rolls
      // while it slides from bleeding anything into the axis.
      const raw = clamp((e.clientX - o.x) / REACH, -1, 1);
      const v = axis(raw);
      this.turn = v;
      /*
       * Driven from the DEAD-ZONED value rather than the raw one, so the picture cannot lie about
       * what the physics got: inside the dead zone the puck sits dead centre because steer really
       * is zero. Rounded to a whole block — a fractional offset would resample the sprite and it
       * would be the only soft thing on the screen.
       */
      thumb.style.setProperty('--tx', String(Math.round(v * TRAVEL)));
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
      this.turn = 0;
      thumb.style.setProperty('--tx', '0');
      el.classList.remove('down');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /*
   * Board position: two halves of one pill, each a plain hold. Nose walks you forward, tail walks
   * you back, and letting go leaves the stance WHERE IT GOT TO rather than springing back — which
   * is not a decision so much as a consequence of weight being a rate (see the header). It is also
   * why two buttons are enough here and would not be enough for the stick.
   *
   * Both halves at once cancels to zero and shows the resting sprite. Not a case worth designing
   * for, but it must not latch: a thumb rolling across the divider does hit both for a frame.
   */
  _bindPill(pill) {
    const sync = () => {
      const { nose, tail } = this._held;
      this.walk = (nose ? 1 : 0) + (tail ? -1 : 0);
      pill.classList.toggle('nose', nose && !tail);
      pill.classList.toggle('tail', tail && !nose);
    };

    for (const z of pill.querySelectorAll('[data-walk]')) {
      const which = z.dataset.walk;
      z.addEventListener('pointerdown', (e) => {
        z.setPointerCapture(e.pointerId);
        this._held[which] = true;
        sync();
        e.preventDefault();
      });
      /*
       * pointerup and pointercancel only, for the same reason as the action pads below: these are
       * held controls, and a thumb that drifts a pixel off the edge of one must not release it.
       */
      const end = (e) => {
        this._held[which] = false;
        sync();
        e.preventDefault();
      };
      z.addEventListener('pointerup', end);
      z.addEventListener('pointercancel', end);
    }
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
   * On the two that carry a state (mute, pause) `.alt` swaps which of the two stacked icons shows.
   * Marked with data-toggle rather than inferred, so restart and camera — which have nothing to
   * show a state for — do not silently pick up a latching icon.
   *
   * Toggling locally is safe because on a touch-first device the button is the only thing that can
   * change these; there is no keyboard to fall out of sync with.
   */
  _bindMeta(el) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onKey(el.dataset.meta);
      if ('toggle' in el.dataset) el.classList.toggle('alt');
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

const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'tail',
};

import { TUNE } from './tuning.js';

/*
 * How long up/down must be HELD before it starts walking your stance.
 *
 * On a keyboard those two keys carry both jobs: they are the walk axis, and they are the keys you
 * double-tap for a pump or a brake. So the taps of a gesture used to walk you a quarter of the
 * way down the deck before the manoeuvre even fired — the pump/brake position coupling, arriving
 * through the input layer rather than through the physics.
 *
 * Splitting them by duration fixes it: a TAP is a gesture and moves nothing, a HOLD is a walk.
 * Kept well under TUNE.snapWindow so both taps of a double are always short enough to stay inert,
 * and short enough in absolute terms that holding to walk still feels immediate.
 */
const WALK_DELAY = 0.13;

export class Input {
  constructor(onKey) {
    this.down = new Set();
    this.steer = 0;
    this.weight = 0;
    this.tail = 0;
    this.brake = 0;           // held brake, on its own channel — see sample()
    this.touch = null;        // a TouchControls, on a touch-first device. See sample().
    this.onKey = onKey || (() => {});
    /*
     * Double-taps. Three actions ride on them — tail twice is a snap, forward twice is a
     * pump, back twice is a brake — so the timing is tracked per action rather than globally,
     * or a tail tap followed by a forward tap would read as a double of whichever came last.
     */
    this._tapAt = { tail: -1e9, up: -1e9, down: -1e9 };
    this._armed = { tail: false, up: false, down: false };
    /*
     * The brake is a HOLD, so it needs to outlive the double-tap that started it — takeDouble
     * consumes `_armed`, which only ever describes the instant a gesture fired. This latch is
     * what carries "still leaning on it" from the second tap through to the release.
     */
    this._brakeLatch = false;
    // when up/down were last pressed, so sample() can tell a tap from a hold. 1e9 = not held.
    this._heldAt = { up: 1e9, down: 1e9 };

    addEventListener('keydown', (e) => {
      if (MAP[e.code]) { this.down.add(MAP[e.code]); e.preventDefault(); }
      // Tab toggles the tuner, so stop it walking focus around the page
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      /*
       * These hang off keydown rather than a press/release pair because there is no key-up
       * edge anywhere in here — keyup only deletes from the set. `e.repeat` is filtered
       * above, so each fires exactly once per physical press and autorepeat cannot fake a
       * double.
       */
      const act = MAP[e.code];
      // start this key's hold clock. Only on a real press — e.repeat is filtered above, so
      // autorepeat cannot keep resetting it and stop the walk from ever engaging.
      if (act in this._heldAt) this._heldAt[act] = performance.now() / 1000;
      if (act in this._tapAt) {
        const now = performance.now() / 1000;
        if (now - this._tapAt[act] < TUNE.snapWindow) {
          this._armed[act] = true;
          this._tapAt[act] = -1e9;      // consume the pair; a third tap starts a new one
          // the second tap of a brake is also the start of holding it down
          if (act === 'down') this._brakeLatch = true;
        } else {
          this._tapAt[act] = now;
        }
      }
      this.onKey(e.code);
    });
    addEventListener('keyup', (e) => {
      const act = MAP[e.code];
      if (act) {
        this.down.delete(act);
        if (act in this._heldAt) this._heldAt[act] = 1e9;
        if (act === 'down') this._brakeLatch = false;   // let go and the rail comes up
        e.preventDefault();
      }
    });
    addEventListener('blur', () => {
      this.down.clear();
      this._brakeLatch = false;
      for (const k in this._heldAt) this._heldAt[k] = 1e9;
      // nothing fires on the far side of an alt-tab
      for (const k in this._armed) { this._armed[k] = false; this._tapAt[k] = -1e9; }
    });
  }

  /**
   * Arm `act` from something other than a keyboard double-tap — a touch button, say.
   *
   * The gesture flags stay the single source of truth for "a snap/pump/brake was asked for",
   * so the physics never learns which input device asked. takeDouble() consumes these
   * identically whichever side set them.
   */
  arm(act) {
    if (act in this._armed) this._armed[act] = true;
  }

  /**
   * True exactly ONCE per double-tap of `act`, then false until the next one.
   *
   * It must be CONSUMED rather than read: sample() returns `this`, and the physics runs
   * several fixed substeps per frame against that same object, so a plain boolean would fire
   * on every substep instead of once per press.
   */
  takeDouble(act) {
    const s = this._armed[act];
    this._armed[act] = false;
    return s;
  }

  sample() {
    const d = this.down;
    const now = performance.now() / 1000;
    // On a right-hander the wall is on your right, so right = turn up the face toward the
    // lip, left = drop down toward the trough and the flats.
    this.steer = (d.has('right') ? 1 : 0) - (d.has('left') ? 1 : 0);
    this.tail = d.has('tail') ? 1 : 0;
    // the brake is latched by a double-tap back and held on its own channel, so the physics no
    // longer has to infer it from a negative stance
    this.brake = this._brakeLatch && d.has('down') ? 1 : 0;
    /*
     * The walk. A key only walks you once it has been HELD past WALK_DELAY, so the taps that
     * fire a pump or a brake leave your stance exactly where you put it.
     *
     * The brake additionally suppresses the back-walk for as long as it is held. Otherwise
     * "double-tap and hold to slow down" would drag you to the tail the whole time you held it,
     * which is the same coupling by a slower route — and it would mean you could never brake
     * from mid-stance, because holding the brake would immediately stop being mid-stance.
     */
    const held = (act) => d.has(act) && now - this._heldAt[act] >= WALK_DELAY;
    this.weight = (held('up') ? 1 : 0) - (held('down') && !this.brake ? 1 : 0);
    /*
     * Touch folds in last and wins where it is live, so its ANALOG axes survive instead of
     * being flattened back to the -1/0/+1 the key Set can express. Keyboard still works
     * whenever no thumb is down.
     */
    this.touch?.apply(this);
    return this;
  }
}

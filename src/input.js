const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'tail',
};

import { TUNE } from './tuning.js';

export class Input {
  constructor(onKey) {
    this.down = new Set();
    this.steer = 0;
    this.weight = 0;
    this.tail = 0;
    this.onKey = onKey || (() => {});
    /*
     * Double-taps. Three actions ride on them — tail twice is a snap, forward twice is a
     * pump, back twice is a brake — so the timing is tracked per action rather than globally,
     * or a tail tap followed by a forward tap would read as a double of whichever came last.
     */
    this._tapAt = { tail: -1e9, up: -1e9, down: -1e9 };
    this._armed = { tail: false, up: false, down: false };

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
      if (act in this._tapAt) {
        const now = performance.now() / 1000;
        if (now - this._tapAt[act] < TUNE.snapWindow) {
          this._armed[act] = true;
          this._tapAt[act] = -1e9;      // consume the pair; a third tap starts a new one
        } else {
          this._tapAt[act] = now;
        }
      }
      this.onKey(e.code);
    });
    addEventListener('keyup', (e) => {
      if (MAP[e.code]) { this.down.delete(MAP[e.code]); e.preventDefault(); }
    });
    addEventListener('blur', () => {
      this.down.clear();
      // nothing fires on the far side of an alt-tab
      for (const k in this._armed) { this._armed[k] = false; this._tapAt[k] = -1e9; }
    });
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
    // On a right-hander the wall is on your right, so right = turn up the face toward the
    // lip, left = drop down toward the trough and the flats.
    this.steer = (d.has('right') ? 1 : 0) - (d.has('left') ? 1 : 0);
    // up/down walk your stance along the deck; space stamps the tail for a hard pivot
    this.weight = (d.has('up') ? 1 : 0) - (d.has('down') ? 1 : 0);
    this.tail = d.has('tail') ? 1 : 0;
    return this;
  }
}

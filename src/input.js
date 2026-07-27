const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'tail',
};

export class Input {
  constructor(onKey) {
    this.down = new Set();
    this.steer = 0;
    this.weight = 0;
    this.onKey = onKey || (() => {});

    addEventListener('keydown', (e) => {
      if (MAP[e.code]) { this.down.add(MAP[e.code]); e.preventDefault(); }
      // Tab toggles the tuner, so stop it walking focus around the page
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.onKey(e.code);
    });
    addEventListener('keyup', (e) => {
      if (MAP[e.code]) { this.down.delete(MAP[e.code]); e.preventDefault(); }
    });
    addEventListener('blur', () => this.down.clear());
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

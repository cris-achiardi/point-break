/**
 * Live wave tuning. These are global multipliers applied inside Wave.raw(), so dragging a
 * slider changes the wall in front of you immediately — no rebuild, no restart.
 */
export const DEFAULTS = {
  // THE SEABED. The wave is derived from these — see bathymetry.js.
  depth: 3.00,     // metres over the reef. Sets wave size (H=0.78d) AND speed (c=sqrt(gd)).
  slope: 0.055,    // seabed gradient. Gentle spills and crumbles, steep throws a barrel.
  swell: 0.42,     // deep-water approach angle (rad). Wider = longer, slower peel.
  wrap: 0.95,      // how hard the point's contours turn. This is what stops it closing out.
  period: 12.0,    // swell period (s). Long period = more power, more likely to barrel.
  peel: 1.00,      // trim on the resulting peel angle
  peelScale: 1.00, // how fast the break RUNS down the line. 1 = normal peel, 0 = the whole
                   // wall breaks at once (closeout) so nothing drags you down the line and
                   // you are free to point straight at the beach.
  length: 300,     // metres the wave travels from first break to the sand

  // the board
  boardLen: 2.30,  // metres. shortboard ~1.9, midlength ~2.3, log ~2.8
  finPos: 0.60,    // 0 = fins set forward and loose, 1 = fins at the tail and drivey
  trim: 0.080,     // radians of nose-up at neutral stance — where the sweet spot sits
  gravity: 1.25,   // how much speed the drop down the face hands you
  turnDrive: 1.40, // speed a turn GENERATES — grows with the square of how hard you turn
  railDrag: 0.055, // what a turn costs; low means a long carve holds its speed
};

export const TUNE = { ...DEFAULTS };

const KEY = 'pointbreak.tune.v1';

export function loadTune() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    for (const k of Object.keys(DEFAULTS)) {
      if (Number.isFinite(v[k])) TUNE[k] = v[k];
    }
  } catch { /* corrupt or unavailable storage is not worth failing over */ }
}

export function saveTune() {
  try { localStorage.setItem(KEY, JSON.stringify(TUNE)); } catch { /* ignore */ }
}

export function resetTune() {
  Object.assign(TUNE, DEFAULTS);
  saveTune();
}

export const isDefault = () => Object.keys(DEFAULTS).every((k) => TUNE[k] === DEFAULTS[k]);

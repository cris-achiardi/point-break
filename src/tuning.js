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

  /*
   * THE CAMERA. The first block places the mouth-mount POV — a GoPro on the rider's head, so
   * it walks the deck with their stance and ducks and pitches with their compression. These
   * are dialled-in values off the tuner, not derived ones; drag them with TAB and hit
   * COPY CAM to produce a replacement block.
   *
   * Note camEye sits a little ABOVE Rider's own head (its box stack is root .07 + body .06 +
   * torso .54 + head .60 = 1.27), and camAhead pushes the lens most of the way to the nose.
   * Both are deliberate — it is a mount on a stalk, not an eyeball.
   */
  camEye: 1.24,    // lens height above the water under the board
  camAhead: 1.07,  // how far out in front of the face the mount sits
  camSide: -0.30,  // lateral offset, +ve to the rider's right (which is toward the wall)
  camPitch: 0.49,  // radians of nose-down. THIS is what decides how much board is in shot.
  /*
   * Vertical lens angle in degrees, before the speed stretch. Wide is not free: it is what
   * decides how much board camPitch has to buy. Go wide and the board climbs into frame on
   * its own, so back camPitch off or you will be staring at your own feet.
   */
  camFov: 80,
  camWall: 3.00,   // seaward bias on the aim — how hard the view is turned into the face
  camWalk: 2.20,   // how much of the rider's stance walk the mount inherits (1 = bolted on)
  camDuck: 0.15,   // lens dropped by a full compression
  camDuckFwd: 0.47, // ...and thrown forward by it, tracking how the torso pitches over
  /*
   * Roll into the turn, as a fraction of the rider's own lean. Reading it off surfer.lean is
   * what keeps the head and the body rolling the same way — see the note in camera.js. The
   * head does not lay over as far as the board does (you stand up against the rail), so this
   * wants to stay well under 1.
   */
  camRoll: 0.57,
  camLead: 0.77,   // how far the head looks AHEAD of the board through a turn
  camBack: 2.00,   // chase only: distance behind the rider
  camHigh: 2.00,   // chase only: height above them
  /*
   * Where the head looks through a BOTTOM turn. Down in the trough swinging up at the wave you
   * are not looking where the board points — you are looking up and across at the lip you are
   * about to hit. These lift the aim off camPitch and swing it further into the face, scaled by
   * how much of a bottom turn you are actually in. A top turn leaves them at zero and keeps the
   * ordinary trim framing.
   */
  camLipLift: 0.55,  // radians of nose-down given back (can take the aim above horizontal)
  camLipWall: 3.50,  // extra seaward bias on the aim, metres at the POV_AIM lever
  camSnapLead: 0.45, // extra look-ahead while a snap is rotating — the head goes first

  /*
   * THE SNAP. Double-tap the tail. The model constants live in CFG.snap; these are the ones
   * worth dragging while you play.
   */
  snapWindow: 0.28,  // seconds between the two taps
  snapMin: 25,       // degrees of rotation from a completely blown snap...
  snapMax: 215,      // ...and from a perfect one. Over 180 reads as a reverse.
  snapSpeed: 13.0,   // speed (m/s) at which speed alone contributes its full share
  snapKeep: 0.30,    // fraction of your speed a blown snap leaves you with
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

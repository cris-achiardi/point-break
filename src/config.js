/**
 * Every tunable in one place. Distances are metres, angles radians unless noted.
 */
export const CFG = {
  ride: {
    // endS is NOT authored — it is derived in Wave from the physical wave length and the
    // peel angles. The wave lives until it has travelled `length` metres shoreward.
    startS: 10,       // where you take off...
    startB: -6,       // ...and where the curl is, so you drop in with 16 m of cushion
    startU: 0.86,     // high on the face — you drop in
    startPsi: -0.85,  // pointing down the face
    startSpd: 5.0,
  },

  phys: {
    G: 9.81,
    // gravity, turn drive and rail drag all live in tuning.js so they can be dialled live

    /*
     * Speed comes from WHERE YOU ARE, not from holding a key. The push term depends only
     * on the wave: how close to the curl, how high on the face, how stood-up the shape is.
     * Weight forward does not add thrust — it planes the board flat and takes drag away.
     * Weight back sinks the tail and adds drag. That asymmetry is the whole speed game.
     */
    push: 3.6,
    pushSteep: 0.65,      // fraction of push that depends on the face actually being steep
    // The wave is a moving hill — a downhill that never runs out. Rather than a one-off drop,
    // it carries your speed up toward a cruising speed set by how fast the wave itself moves,
    // so a 2 m face still bombs you along. You can beat this floor with pumps and drops.
    waveGlide: 2.6,       // cruising speed as a multiple of celerity (c ~ 5 m/s -> ~13 m/s)
    waveGrab: 1.6,        // how hard the moving face pulls you up to that speed
    // The wave stands up under you and keeps lifting you back onto the face if you drop too
    // low — an UPWARD-only push (never a downward drag, so it is not the old skid), which is
    // what keeps you on a small face instead of sliding off the base. Point the nose down
    // hard and you still beat it and drive to the beach.
    wallCatch: 0.30,      // below this height on the face the rising wave lifts you back up
    wallLift: 5.0,        // how strongly
    pumpGain: 2.2,        // bonus for driving through the bottom of a turn
    turnDriveMax: 9.5,    // ceiling on the drive a single turn can make
    turnDriveCeil: 18.0,  // ...and the speed past which turning stops adding anything
    // A hard bottom turn redirects the rising water at ~90 deg and CONVERTS it to forward
    // thrust — you come out of the turn faster than you went in. This lets turn-drive work
    // low on the face (where you bottom-turn), not just mid-face.
    btGain: 5.5,          // extra thrust from banking hard against the rising water

    // RAIL GRIP (Coanda). A rail set at speed grips the face and draws the board UP into the
    // wave, so you can hold and climb a high line rather than sliding off it. It needs speed
    // — like nose-riding, it fails when slow — and eases off near the lip so it holds you on
    // a high line instead of throwing you over. This is the rail, not the fins.
    railGrip: 2.6,        // strength of the up-the-face grip
    gripSpeed: 7.0,       // speed (m/s) at which the rail grips fully
    gripLine: 0.72,       // the high trim line the grip draws you to (climb past it by aiming up)

    /*
     * The water in a wave face is MOVING, not static terrain. It rises up the face near the
     * crest and drops away near the trough. Without this you pay full g*sin(beta) to climb,
     * which is why the board used to die on the way to the lip — in reality the face carries
     * you up. Same term, opposite sign low down, is what loads a bottom turn.
     */
    carryFrac: 0.55,      // how much of the along-shore track shows up as board flow
    waterUp: 7.0,         // m/s the face is climbing near the lip, at full pocket
    liftGain: 1.30,       // that flow, as an acceleration on the board
    liftZero: 0.25,       // height on the face where the water neither rises nor falls

    flatsGlide: 2.5,      // extra drag once you slide well past the trough onto the inside

    dragLin: 0.100,
    dragQuad: 0.0190,

    /*
     * Planing, from the momentum model (surfhydrodynamics eq. 20-28):
     *     lift  Fy ~ rho L W V^2 sin^2(a) cos(a)
     *     drag  Fx ~ rho L W V^2 sin^3(a)
     *     efficiency Fy/Fx = cot(a)
     * So flatter is ALWAYS more efficient — but you still need enough angle to carry your
     * weight, and the angle you need falls as V^2. The best trim is therefore the smallest
     * angle that still planes, and it walks forward as you speed up. Being too flat is not
     * "more glide", it is the nose starting to bury.
     *
     * A midlength carries its rider around the middle-back of the deck, so the optimum sits
     * just behind centre at normal speed and you never need to walk to the nose.
     */
    trimStance: 0.100,    // radians of nose-up gained per unit of stance walked back
    liftNeed: 0.85,       // sets the angle needed to hold the rider up at a given speed
    planeBase: 0.62,      // drag multiplier at perfect trim
    trimOver: 14.0,       // too much angle: you are dragging the tail through the water
    trimUnder: 12.0,      // too little: the nose loads up and starts to bury
    trimTurnRelief: 0.65, // tail-down mid-turn is fin load, not brake
    railBrake: 0.70,      // rail drag is much worse pivoting off the tail than carving
    railDrive: 0.30,
    // Out past the trough there is no slope and no push, so you stop. This must only bite
    // BELOW the trough — the trough itself is where every bottom turn passes through.
    dragFlats: 0.42,
    flatsFrom: 0.02,      // u below which the flats penalty starts
    uFloor: -0.35,        // a little give below the trough so a bottom turn is not hard-walled,
                          // but not so far that you sink onto dead flat water and bog

    /*
     * Steering. The pivot is the fins, at the tail. Weight back loads them and the board
     * swings sharply; weight forward puts you on the rail and the arc draws out long.
     * A midlength does not snap, so the base rate is gentle.
     */
    turnBase: 1.45,       // rail carve, rad/s at a standstill — falls off with speed
    turnPivot: 2.60,      // fins pivot, rad/s at full weight-back — speed independent
    turnDriveDamp: 0.40,  // weight-forward: rail only, long drawn arc
    turnSpdRef: 22,       // speed at which turns are ~half as tight
    railFlow: 5.0,        // speed below which the rail stops gripping and turns go soft
    gravTurn: 0.22,       // fins and rails hold your line; gravity barely re-aims you
    gravTurnTo: 1.40,     // ...and it stops applying once you are swinging past ~80 deg

    /*
     * You can turn all the way back up the line. Past 90 degrees cos(psi) goes negative,
     * so you genuinely travel backwards toward the curl — which is the entire point of a
     * cutback: you are repositioning into the pocket, and you will run out of face into
     * the foam if you overdo it.
     */
    uCeil: 1.14,          // headroom above the lip line to finish a turn and drop back in

    /*
     * Stance is walked, not sprung. Holding the key moves you along the deck at stanceRate
     * and you STAY there — releasing does not recentre you, because trimming a board is a
     * position, not a lean. Past stepAt you are properly walking rather than shifting.
     */
    stanceRate: 2.30,     // stance units per second while a key is held
    stepAt: 0.45,         // |stance| past which it reads as walking the board

    // pushing the tail (space): how much leverage you have from where you are standing
    tailLevBase: 0.10,
    tailLevGain: 0.75,
    tailLevPivot: 0.35,   // stance at which leverage over the tail runs out entirely

    // board geometry — how much your stance is actually worth
    boardRefLen: 2.30,    // the length the handling numbers above were tuned at
    lenGlide: 0.35,       // longer board, more waterline, better glide
    finLeverBase: 0.55,   // pivot authority with the fins set forward...
    finLeverGain: 0.90,   // ...and how much more you get with them at the tail
    finBiteBase: 0.62,    // a loose forward-fin board generates less drive off a turn
    finBiteGain: 0.48,
  },

  wave: {
    // how the face profile bends from trough (u=0) to lip (u=1).
    // tangent angle beta(u) = phi * u^profE  — >1 makes the face concave/hollow.
    profE: 1.35,
    phiMax: 3.02,         // ~173 deg, a fully thrown lip

    // steepness vs. distance ahead of the curl: vertical only where it is throwing
    steepShoulder: 0.30,  // a long way down the line, the same swell is this much of a ramp
    steepFall: 26,        // metres over which steepness decays toward the shoulder

    // shoulder length scales with size and peel; every distance above is multiplied by it
    shoulderRefA: 2.20,   // the wave size these reference distances were tuned at
    shoulderRefPeel: 6.0,
    shoulderMin: 0.55,
    shoulderMax: 2.20,

    standNear: 14,        // ahead of the curl the wave is fully stood up until here
    standFar: 95,         // ...and is a formless swell out past here
    standMinA: 0.40,

    pitchAt: 2.0,         // the lip pitches hardest this far ahead of the break point
    pitchWidth: 6.0,
    pitchGain: 0.55,      // extra radians of curl in the pocket

    brokenOver: 9.0,      // metres behind the curl for the face to fully collapse
    brokenPhi: 0.44,
    brokenChop: 0.5,
  },

  /*
   * THE SNAP. Double-tap the tail to break the board loose in one explosive rotation.
   *
   * Everything else in the rig is a lag — tailPush is an 83 ms filter feeding pivot, feeding
   * dpsi, which is itself an 83 ms filter into turnRate. Two cascaded poles is ~0.4 s to full
   * rate, which is why nothing here could ever be explosive. The snap deliberately bypasses
   * that whole chain and drives psi directly.
   *
   * How good it comes out is decided entirely by WHERE you are when you tap, never by how
   * long you held anything. The face terms below are what a snap is actually made of; speed
   * is the equaliser that lets you force one out of a section that has not stood up.
   */
  snap: {
    // How vertical the face is under you. The existing faceSteep map saturates at phi 1.5,
    // which is useless here: measured phi runs 2.7-2.9 right at the curl and only drops to
    // 1.57 some 20 m down the line, so a 0.35-1.5 window reads "maximum" across the whole
    // pocket. This wider window actually discriminates a thrown lip from a vertical wall.
    phiLo: 0.70,
    phiHi: 2.60,

    /*
     * Weights on the three face terms; these sum to 1. Attack angle enters TWICE — once as
     * its own share, and once as a partial multiplier on the section terms — because with a
     * purely additive split, being high on a vertical wall while pointed straight DOWN the
     * face still graded 163 deg. It should not: that is a drop, not a snap. atkFloor is how
     * much of the section is still worth something with the nose aimed completely wrong.
     */
    wVert: 0.42,
    wAttack: 0.40,
    wHeight: 0.18,
    atkFloor: 0.45,
    /*
     * The difficulty curve. These three are what make a GREAT snap rare rather than routine,
     * and they are deliberately steep: a merely decent setup should return a merely decent
     * snap. attackExp bites hardest — sin(psi) alone was too kind to a half-committed climb,
     * so it is raised to a power and a lazy 35 deg approach now grades ~0.25 instead of 0.56.
     */
    attackExp: 1.60,
    setupExp: 1.55,   // >1 so a mediocre setup is punished much harder than it looks
    spdShare: 0.24,   // how much of the grade raw speed can buy on its own

    // What the turn-drive and rail-drag terms are allowed to read as |turnRate| mid-snap.
    // They were written for a carve topping out near 4 rad/s; see the note at the om cap.
    omCap: 1.6,

    degExp: 1.25,     // q -> angle curve. >1 holds the big angles back for a real setup.
    durMin: 0.18,     // a flailed 25 deg flick...
    durMax: 0.40,     // ...against a committed 200 deg rotation
    cool: 0.45,       // seconds before another snap can fire

    // the floor is TUNE.snapKeep so it can be dragged; this is the small projection a
    // perfect snap hands back — the reward the tail stomp never gave you
    keepBest: 1.02,
    blownQ: 0.22,     // below this the snap counts as blown
    stallTime: 0.80,  // and you bog for up to this long
    stallDrag: 2.5,   // as a multiple of the linear drag term
  },

  /*
   * THE PUMP. A decompression: you spring forward off the front foot, unstick the rail, drive
   * off the rising water and then settle back down onto the face. A power trim.
   *
   * It only pays where there IS rising water — out on a dead shoulder or the flat inside you
   * are just bouncing on a board. `room` is what stops it being a free-energy pedal: the faster
   * you already are the less it returns, so it tops you up toward the wave's own speed.
   *
   * LINKING is how you actually accelerate. One pump is a nudge; pumps landed in rhythm
   * compound, each one worth more than the last, so a good surfer generates speed down the line
   * rather than waiting for the wave to hand it over. `room` still bounds the whole chain, so
   * linking gets you to the ceiling faster — it does not raise it.
   */
  pump: {
    /*
     * A pump that lands at all is worth something REAL. `base` is the floor — about 5 km/h — and
     * `gain` is what placement and stance earn on top. Splitting them matters: the old single
     * gain was multiplied by quality AND stance AND room, so three individually-reasonable
     * factors compounded into a pump worth roughly 1 km/h that drag ate immediately.
     */
    /*
     * Sized so that even a mid-stance pump at ordinary riding speed clears 5 km/h AFTER `room`
     * has taken its cut — `room` roughly halves the payout at a typical 8 m/s, which is what made
     * the old numbers feel like nothing.
     */
    base: 2.40,       // m/s from any pump that lands on the face
    gain: 1.60,       // m/s more, earned by placement and stance
    /*
     * The ceiling belongs to the WAVE, not to a constant. A stood-up steep pocket will carry you
     * fast; a fat, barely-standing shoulder will not, however well you pump. This is what caps a
     * link chain — the wave decides how much speed is there to be had.
     */
    ceilMin: 9.5,     // fat, barely standing water
    ceilMax: 19.5,    // a steep, fully stood-up pocket
    lift: 0.55,       // metres up the face it also carries you — where the speed comes from
    hop: 1.00,        // metres the board is thrown FORWARD — a pump is a jump, so it travels
    /*
     * Unweighting the board while the pump unloads: the "reduce friction" half of the manoeuvre,
     * and the reason the speed STICKS. Without it a pump lifted you above the drag equilibrium
     * and the next few frames pulled you straight back down to it — speed gained and instantly
     * lost, which is exactly what it felt like.
     */
    slip: 0.55,       // fraction of drag cancelled at the pump, decaying away over `show`
    cool: 0.20,       // rhythm floor: fast enough to chain, slow enough not to be a mash button
    show: 0.30,       // how long the pump reads on the HUD/effects
    /*
     * Stance scales the return rather than being moved by it. A pump is a drive off the FRONT
     * foot, so standing forward is where the power is; parked over the fins there is nothing to
     * spring off and it barely returns anything.
     */
    levNose: 1.00,    // multiplier standing fully forward...
    levTail: 0.15,    // ...and fully back over the fins
    levPivot: -0.30,  // stance below which a pump stops working at all
    /* the chain */
    linkWin: 0.62,    // land the next pump inside this to keep the chain alive
    linkStep: 0.34,   // extra multiplier per linked pump
    linkMax: 2.30,    // ceiling on the chain multiplier
  },

  /*
   * THE BRAKE. Hold it and you keep slowing, release and the rail comes up. You are shifting
   * your weight back to bog the tail, so how much it bites is purely HOW MUCH TAIL YOU CAN
   * REACH — a stance decision you make with the walk, before and during the brake.
   *
   * It does not move your stance for you. Standing at dead centre you are not over the tail at
   * all and there is almost nothing to bog, which is the whole point: where you stand on the
   * board is the control, and the brake button only asks.
   */
  brake: {
    cutNose: 0.99,    // speed retained by the initial set with no leverage...
    cutTail: 0.74,    // ...and with all of it. Gentle: the HOLD is what dumps the speed.
    holdDrag: 9.5,    // extra linear drag for as long as you keep it held, scaled by leverage
    /*
     * Constant deceleration, NOT scaled by speed, so a held brake actually arrives at a stop.
     * holdDrag alone is proportional to how fast you are going, which decays toward zero without
     * ever reaching it — you would coast forever at a crawl. This is the term that lets you sit
     * down and stop dead while the wave runs on without you.
     */
    holdStop: 7.0,    // m/s^2 at full leverage
    /*
     * How much of the wave's carry a held brake defeats.
     *
     * `carry` is the wave translating a PLANING board along with it — and bogging the tail is the
     * act of not planing any more. Without this the HUD (which shows vWater = hypot(spd, carry))
     * had an unbeatable ~18 km/h floor: you could stand on the brake and watch the number refuse
     * to fall, because stopping the board does nothing to carry.
     */
    carryCut: 0.85,   // fraction of carry cancelled at full leverage
    cool: 0.12,       // just enough to stop a re-set firing every frame
    /*
     * Leverage over the tail: how much of it you can actually reach from where you stand.
     *
     * Near zero at mid-stance, because standing over the middle of the board you are not bogging
     * anything. Not EXACTLY zero, though — the brake has to be able to bring you to a stop from
     * any stance if you hold it long enough. From the middle that takes a very long time, which
     * is the honest answer: you can stop, but not quickly, and not without committing.
     */
    levBase: 0.08,    // bite standing at the pivot...
    levGain: 0.92,    // ...and how fast it comes on as you walk back from there
    levPivot: 0.00,   // stance from which leverage over the tail starts to run out — dead centre
  },

  pocket: {
    // power as a function of d = yourS - breakS
    behindFade: 6.5,      // power dies this far behind the curl
    peakEnd: 6.0,         // full power from d=0 to here
    tail: 20.0,           // e-folding distance out on the shoulder
    tailExp: 1.5,
    // The trim line is mid-face, but the whole face carries power — being low on the face
    // is a bottom turn, not a mistake. The dead zone is past the trough (u < 0), and that
    // is enforced by dragFlats rather than by starving this band.
    faceCenter: 0.45,
    faceWidth: 0.52,

    // failure
    foamEnter: -1.5,
    foamGrace: 1.3,       // seconds you can survive inside the foam ball
    lostShoulder: 46,     // d beyond which a slow board is a dead board
    lostSpeed: 4.5,
  },

  score: {
    pocketRate: 11,       // per second at full pocket power
    trimRate: 7,          // per second holding a quiet fast line
    barrelRate: 62,
    turnBase: 42,
    speedRate: 0.55,
    distRate: 0.5,
    comboStep: 0.22,      // multiplier gained per scoring event
    comboMax: 5.0,
    comboDecay: 0.45,     // multiplier lost per second out of the pocket
  },

  render: {
    baseH: 240,           // internal render height — the whole N64 trick
    maxW: 560,
    levels: 26,           // colour steps per channel after dithering
    fogNear: 55,
    fogFar: 420,
    // the base lens angle is live — see TUNE.camFov. This is only the speed stretch on top.
    fovSpeed: 0.42,
    far: 1400,
  },

  mesh: {
    back: 70,             // metres of wave kept behind you
    ahead: 230,           // ...and ahead of you
    nBack: 26,
    nAhead: 86,
    nFace: 22,            // rows from trough to lip
    flatRows: [-62, -34, -18, -8, -2.6], // shoreward offsets for the inside water
    nBackSkirt: 5,
  },
};

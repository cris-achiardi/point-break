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
    stanceRate: 1.15,     // stance units per second while a key is held
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
    fov: 64,
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

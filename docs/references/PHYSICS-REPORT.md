# Physics audit — Point Break

*Audit of `src/bathymetry.js`, `src/wave.js`, `src/surfer.js` as of this session.
Every claim below was measured with headless probes (`scratchpad/audit.mjs`), not read off the code.*

---

## 1. The model, as built

Three layers, each consuming only the one below:

```
bathymetry.js      the seabed: depth(s), slope(s), contour bearing(s)
      │
wave.js            coastal engineering: the wave derived from the bottom
      │
surfer.js          rider dynamics in wave coordinates (s, u, spd, psi)
```

### Seabed → wave (`wave.js raw()`)

| quantity | formula | source |
|---|---|---|
| celerity | `c = √(g·d)` | shallow-water gravity wave |
| breaker height | `H = 0.78·d` | depth-saturated breaker index |
| breaker type | `ξ = slope / √(H/L₀)`, `L₀ = gT²/2π` | Iribarren / surf-similarity |
| pocket steepness | `φ = lerp(46°, 138°, smoothstep(0.35, 1.9, ξ))` | spilling→plunging map |
| refraction | `sin θ / c` conserved | Snell's law |
| peel angle | `α = (θ + contour) / peelTrim` | residual crest-to-contour angle |
| peel speed | `peel = c / tan(α)` | **along-crest**; along-shore would be `c/sin(α)` |
| ride duration | `T = length / c̄` | wave dies when it reaches the sand |
| point length | `endS = length · mean(1/tan α)` | derived, not authored |

Sections (BARREL, FAT…) are **classified from ξ and peel**, not authored. Verified: steepening
the bottom from 1:18 to 1:9 converts fat sections to barrels with no other change.

### Rider forces (`surfer.js step()`)

`spd` is velocity **in the wave frame**; `vWater = hypot(spd, carry)` approximates speed
through the water, where `carry ≈ 0.55·(c/sin α)·stand` is the ground-track of holding
station on the curl. All hydrodynamics (fin grip, planing, turn radius, drag ceilings) run
off `vWater`; only pocket-position bookkeeping runs off `spd`.

Longitudinal budget (all in m/s², applied to `spd`):

| term | expression | role |
|---|---|---|
| gravity + face flow | `(−g·G_tune·sin β + lift)·sin ψ` | drop gains, climb costs, rising face refunds |
| pocket push | `push · pw · faceBand · steep` | purely positional — no key adds thrust |
| pump | `pumpGain · drive · max(0,−sin ψ) · pw · faceBand` | driving through the bottom of a turn |
| turn drive | `min(cap, turnDrive·ω²·pw·faceBand·flow)·bite·(1−v/18)` | hard turns generate, saturating |
| planing drag | `−plane·(lin·spd + quad·vw·spd)` | `plane` = trim-mismatch penalty (see below) |
| rail drag | `−railDrag·railBite·ω·spd` | what a carve costs |
| flats | `−dragFlats·…` below `u = 0.02` only | past the trough, not in it |

Trim follows the momentum planing model (surfhydrodynamics eq. 20–28): required attack angle
`α_req = √(liftNeed/(v²·lenR))` falls with speed², drag is the **mismatch** `|α − α_req|`
penalised both ways (tail drag vs nose bury). Verified: settled-speed-by-stance peaks at
centre (46 km/h), tail is graceful (~30), nose is catastrophic (7 — it buries), and the
optimum walks forward with speed (−0.75 @ 5 m/s → +0.25 @ 14 m/s).

Steering: `carve` (grip-limited, ∝1/length) + `pivot` (space-bar tail stamp, speed-independent,
gated by stance leverage — you can't stamp a tail you're not standing near). Heading is a true
wrapping angle; a cutback must pass 180° to come back down the face, which is geometrically
correct and was the bug that made cutbacks impossible in an earlier revision.

---

## 2. Verified sound (measured)

- **Difficulty envelope**: all naive policies (do nothing, mash ↑, hold brake, never-brake pump)
  die in 7–10 s; a competent trim-and-thread line rides 60–67 s and scores ~1.5× a non-trimming
  line. No inversion: skill monotonically pays.
- **No free-energy exploit**: 6 s of full-lock spin with tail stamp in the pocket settles at
  39 km/h — *below* the 45–47 km/h clean-trim equilibrium. Turn drive saturates via cap and
  the `(1 − vw/18)` ceiling. Spin never beats riding well.
- **Two speeds genuinely decoupled**: stalled on the tail to hold station = 33–39 km/h through
  the water (turnable) while `closing ≈ 0` on the curl. Shoulder is still dead (8–11 km/h)
  because `carry` scales with `stand`. This is the barrel-stall / infinite-hill behaviour.
- **Lip timing**: 20 km/h into the curl → launched, +air; same turn on the shoulder → nothing,
  speed collapses to ~1 km/h; 14 km/h at the curl → over the falls. A real timing window.
- **Crest geometry**: bearing sweeps 0→16° monotonically, max bow 10.8 m over 296 m (3.6%
  sagitta) — a long wall with a gentle wrap, snake fixed.
- **Angle wrap correctness**: turn scoring uses `turnRate·dt` (not wrapped-angle differences);
  foam-bounce facing test uses `cos ψ` (a 200° swing wraps to a large *negative* ψ).
- **Numeric safety**: fixed 120 Hz step, exp-form `approach()`, audio params NaN-guarded.

---

## 3. Issues found (ranked)

### 3.1 `pocketPower` discontinuous at the curl line — **FIXED**
`surfer.js:26`. Was: `pw(−0.001) = 0.700`, `pw(0) = 1.000` — a 30% step in the main propulsion
term at the line you cross constantly when riding deep, felt as an invisible lurch.

The behind-curl branch now shapes as `fade·(0.7 + 0.3·fade)`, which preserves the "the foam
gives you less" intent while landing exactly on 1.0 at the curl. Re-measured:

```
d=-0.200  pw=0.960      d=0.000  pw=1.000
d=-0.050  pw=0.990      d=0.001  pw=1.000
d=-0.001  pw=1.000      d=0.050  pw=1.000
```

C0-continuous. There is still a slope kink at d=0 (0.2 behind, 0 in front) which is
imperceptible next to what it replaced.

### 3.2 Two inconsistent definitions of "deep water" — **FIXED**
`wave.js:111` used `deepCelerity = √(g·depth·6)` (depth-based) while Iribarren used
`L₀ = gT²/2π` (period-based) — the two halves of the same swell disagreed. Now
`c₀ = gT/2π`, so period feeds both ξ and Snell. Re-measured, PERIOD is a real control:

| period | pocket | peel |
|---|---|---|
| 7 s | 46–119° | 2.2–7.2 m/s |
| 12 s | 46–138° | 2.6–8.5 m/s |
| 18 s | 49–138° | 2.8–9.2 m/s |

Longer swell now both hollows the pocket *and* refracts harder, exactly as it should.
Side-effect: `c₀` rose from 13.3 to 18.7 m/s at T=12, so refraction is stronger and default
peel is ~10% quicker than before the fix (2.4–7.7 → 2.6–8.5 m/s).

### 3.3 `vWater` is direction-blind — accepted simplification, should be documented
`surfer.js:187` `hypot(spd, carry)` treats board velocity and water flux as orthogonal always.
Measured: dropping (ψ=−0.9) and climbing (ψ=+0.9) at the same `spd` give identical vWater
(32 km/h), when moving *with* the through-face flow should reduce relative speed and *against*
it increase it. The `faceLift` term captures the energetic half of this, so gameplay reads
right, but fin grip / planing get the wrong v in those extremes. Cheap improvement if wanted:
`vWater = hypot(spd·cosψ, carry − spd·sinψ·k)`.

### 3.4 No cross-face advection — emergent behaviour is acceptable, mechanism is absent
There is no term moving `u` except your own heading (`u̇ = spd·sinψ/L`). The "wave passes
under you" failure is implemented along-line (foam catches you via `d`), never cross-section.
Measured stall test: parked at 0.5 m/s the board is gravity-steered downhill, slides to the
trough, foam eats it in 3.0 s — a *reasonable-looking* death, but it comes from the steering
nudge, not from the face migrating. Fine for now; becomes visible if `gravTurn` is ever set
to 0 (a parked board would then hover on the face indefinitely).

### 3.5 POINT slider extremes produce degenerate waves — **FIXED**
Was 0.20–1.60. Measured at the old extremes: wrap=0.20 → peel 11.8–44.9 m/s over a 1395 m
point (uncatchable closeout everywhere); wrap=1.60 → peel 0.3–3.5 m/s over 98 m. Both
physically correct, neither a wave.

Scanned the whole range after fix 3.2 to find where it is actually surfable:

```
POINT   peel range      along
  43°   4.0-11.6 m/s    446m   fast sections unmakeable
  46°   3.6-10.7 m/s    411m   ok      <- lower bound
  54°   2.6- 8.5 m/s    325m   ok      (default)
  66°   1.5- 6.4 m/s    238m   ok      <- upper bound
  69°   1.2- 6.1 m/s    220m   crawls
```

Clamped to 0.80–1.15 rad (46°–66°), step 0.005. Both ends are now playable waves rather than
failure modes. Note my first proposed clamp (0.55–1.30) was computed against the *old*
refraction and would still have exposed 17.6 m/s peel — worth re-measuring any range that
was derived before an upstream fix.

### 3.6 Minor, listed for completeness
- `gravTurn` hard gate at |ψ|=1.40: torque steps −0.028→0 rad/s. Smoothed by `approach(12)`;
  imperceptible. Replace the gate with a `cos`-fade if it ever shows.
- `dist` accumulates along-crest only — the ride-summary "DISTANCE" understates true ground
  covered (excludes ~5 m/s shoreward drift ≈ +300 m). Cosmetic; decide which number you want
  to show.
- `peelAt` end-of-point slams to a hard-coded 24 m/s rather than deriving the closeout from
  the beach bathymetry. Invisible (it's the kickout trigger) but inconsistent with the
  everything-derived philosophy.
- Over-the-falls gate (`spd < 5.0` at `surfer.js:350`) tests wave-frame speed while the board
  may carry 30+ km/h `vWater` — defensible (you *are* pinned relative to the lip) but worth
  knowing it's frame-sensitive.
- `stepAir` landing check reuses stale `this.d` from entry frame ordering — recomputed at
  line 498 before use; verified correct, no action.

---

## 4. Deliberate simplifications (documented, not defects)

- Energy is additive with caps, not conserved — a game loop, exploit-tested rather than proven.
- `H = 0.78d` couples size to speed by design: you cannot have a big slow wave; slow is bought
  with peel angle. This is real physics and was adopted intentionally.
- Whitewater, foam-ball, and lip-throw are kinematic effects (impulses/overrides), not fluid.
- The crest bends at 30% of the contour turn (`P_BEND`) — a stylised stand-in for the full
  lag dynamics of refraction around a headland.
- Rail-grip loss at low speed replaces a balance/falling model — implicit by design.

## 5. Status

**Applied:** 3.1 (pocketPower continuity), 3.2 (deepCelerity from period), 3.5 (POINT clamp).

**Left alone deliberately:** 3.3 (vWater direction-blindness) and 3.4 (no cross-face
advection) are both masked well by other terms and would cost more complexity than they buy.
3.6 items are cosmetic or invisible.

### Post-fix regression check

Naive play still fails fast — and now fails for the *right* reasons, since walking to the
nose buries it:

```
do nothing                WIPEOUT   5s   15m
mash up (walk to nose)    WIPEOUT   5s   10m
mash down (walk to tail)  WIPEOUT   5s   16m
hold space + steer        WIPEOUT   4s   13m
```

Competent play rides 60–70 s over 297–350 m, ~19 km/h average. No free-speed exploit
(full-lock spin still settles at 39 km/h, below the 46–48 km/h trim equilibrium).

### One thing to watch

The trim-vs-no-trim score gap is marginal and seed-dependent (seed 2 favours trimming
7521 vs 6132; seeds 1 and 3 slightly favour not bothering, 5156 vs 5399 and 4361 vs 4976).
The synthetic bot chases `stanceOpt` continuously and pays rail drag for the walking, which
a human wouldn't. This is a *measurement* limitation as much as a balance one — worth judging
by feel before tuning against it. If it does need strengthening, widen the trim penalty
curve (`trimOver` / `trimUnder`) rather than touching the planing model.

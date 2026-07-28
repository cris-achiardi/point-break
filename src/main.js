import * as THREE from 'three';
import { CFG } from './config.js';
import { Wave } from './wave.js';
import { Surfer, STATE } from './surfer.js';
import { Input } from './input.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Pixelizer } from './render/renderer.js';
import { buildScene, followWorld } from './render/scene.js';
import { WaveMesh } from './render/waveMesh.js';
import { Rider } from './render/rider.js';
import { CameraRig, CAM } from './render/camera.js';
import { Spray } from './render/spray.js';
import { Tuner } from './tuner.js';
import { TUNE } from './tuning.js';
import { clamp, clamp01, lerp, approach } from './rng.js';

const canvas = document.getElementById('gl');
const pix = new Pixelizer(canvas);
const hud = new Hud();
const audio = new Audio();

let wave, surfer, world, waveMesh, rider, spray, rig;
let running = false, paused = false, seed = 1, best = 0;
let endT = 0, tint = 0, dark = 1;

const sf = {
  px: 0, py: 0, pz: 0, ux: 0, uy: 1, uz: 0,
  tx: 1, ty: 0, tz: 0, nx: 0, ny: 1, nz: 0, beta: 0, A: 1, phi: 1,
};

// size/shape/speed are read live by the wave model; changing the wave's LENGTH rescales the
// whole section layout, so that one restarts the ride on the same seed.
const tuner = new Tuner((rebuild) => { if (rebuild) start(seed); });

const input = new Input((code) => {
  if (code === 'Tab') tuner.toggle();
  if (code === 'KeyC') rig?.toggle();
  if (code === 'KeyR') start(seed + 1);
  if (code === 'KeyM') audio.toggleMute();
  if (code === 'KeyP' && running) { paused = !paused; paused ? audio.suspend() : audio.resume(); }
  if (code === 'Enter') {
    if (!running || !surfer.alive) start(running ? seed + 1 : seed);
  }
});

/*
 * On a phone or tablet, hang analog thumbsticks off the same Input. Built only where it is
 * wanted — a desktop ride never constructs the pads and never touches sample()'s touch hook.
 */
let touch = null;
let touchNote = 'off';
if (isTouchDevice()) {
  /*
   * try/catch so a fault in here can never take the game down with it. Without it a throw during
   * construction aborts module evaluation, so build() and the first requestAnimationFrame at the
   * bottom of this file never run — and the failure presents as a silent blank screen rather than
   * as the error it actually is.
   */
  try {
    touch = new TouchControls(input, input.onKey);
    input.touch = touch;
    /*
     * `is-touch`, NOT `touch`. The container's hide rule was once the class selector
     * `.touch { display: none }`, which matches EVERY element carrying that class — so putting
     * `touch` on <body> set display:none on the whole document. The page was not crashing, it was
     * being told not to render, which is why it threw nothing and reported a healthy 60fps. The
     * container rules are ID-scoped now, and this name cannot collide with them either way.
     */
    document.body.classList.add('is-touch');
    touchNote = 'on';
  } catch (e) {
    touchNote = 'THREW: ' + (e && e.message);
    throw e;
  }
}

/* ------------------------------------------------------------------ setup */

function build() {
  wave = new Wave(seed);
  surfer = new Surfer(wave);

  if (world) {
    world.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  world = buildScene(wave);
  waveMesh = new WaveMesh(wave, world.scene);
  rider = new Rider(world.scene);
  spray = new Spray(world.scene);
  rig = new CameraRig(pix.aspect);
}

function start(newSeed) {
  seed = newSeed;
  build();
  // drop anything armed while the results card was up, so a restart does not open with a
  // phantom snap from whatever you were mashing when the last ride ended
  for (const a of ['tail', 'up', 'down']) input.takeDouble(a);
  audio.start();
  hud.hideOverlay();
  hud.show(true);
  touch?.releaseAll();      // no axis or held button carried over from the last ride
  touch?.show(true);
  running = true;
  paused = false;
  endT = 0;
  tint = 0;
  dark = 1;
  last = performance.now();
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'go') start(seed + (running ? 1 : 0));
});

addEventListener('resize', () => {
  const a = pix.resize();
  rig?.resize(a);
});

/* -------------------------------------------------------------- diagnostics
 * A phone gives you no console and no devtools, so "it goes black" is all the signal you get.
 * This prints the handful of numbers that distinguish the ways that can happen: the loop having
 * stalled (frame count stops climbing), a NaN having poisoned the camera or the rider (Three.js
 * renders nothing at all and reports no error), the post-process having faded to black on its
 * own, or the drawing surface having collapsed to nothing.
 */
const DIAG = new URLSearchParams(location.search).get('debug') === '1';
const diagEl = document.getElementById('diag');
let frames = 0;
let fps = 0, fpsT = 0, fpsN = 0;

function bad(...vals) {
  return vals.some((v) => !Number.isFinite(v));
}

function diag(dt, mode) {
  frames++;
  fpsT += dt; fpsN++;
  if (fpsT >= 0.5) { fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
  if (!DIAG || !diagEl) return;
  const c = rig?.cam.position;
  const broken = bad(c?.x, c?.y, c?.z, sf.px, sf.py, sf.pz, surfer?.spd, surfer?.x, surfer?.z);
  diagEl.classList.add('on');
  diagEl.classList.toggle('bad', broken);
  const inf = pix.renderer.info;
  diagEl.textContent = [
    `${mode}  f${frames}  ${fps.toFixed(0)}fps  ${broken ? '*** NaN ***' : 'finite'}`,
    `cam  ${c ? `${c.x.toFixed(1)} ${c.y.toFixed(1)} ${c.z.toFixed(1)}` : '-'}`,
    `rider ${sf.px.toFixed(1)} ${sf.py.toFixed(1)} ${sf.pz.toFixed(1)}`,
    `spd ${(surfer?.spd ?? 0).toFixed(1)}  s ${(surfer?.s ?? 0).toFixed(0)}  u ${(surfer?.u ?? 0).toFixed(2)}`,
    `dark ${dark.toFixed(2)}  tint ${tint.toFixed(2)}`,
    `buf ${pix.target.width}x${pix.target.height}  css ${innerWidth}x${innerHeight}`,
    `geo ${inf.memory.geometries} tex ${inf.memory.textures} calls ${inf.render.calls}`,
    `touch ${touchNote}  nodes ${document.getElementById('touch')?.childElementCount ?? '-'}`,
  ].join('\n');
}

/* ------------------------------------------------------------------- loop */

let last = performance.now();
let acc = 0;
const FIXED = 1 / 120;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running) { renderIdle(); diag(dt, 'IDLE'); return; }
  if (paused) { diag(dt, 'PAUSED'); return; }

  const inp = input.sample();

  /* physics at a fixed step so hard turns stay stable */
  acc = Math.min(acc + dt, 0.1);
  const wasSnapping = surfer.snapT > 0;
  while (acc >= FIXED) {
    surfer.update(FIXED, inp);
    acc -= FIXED;
  }

  const t = surfer.time;
  wave.setAdvance(t);              // march the crest shoreward before anything reads frame()
  surfer.surface(sf);

  /* --- events --------------------------------------------------------- */
  for (const ev of surfer.events) {
    if (ev.kind === 'tube') audio.blip(880, 0.3, 0.2);
    else if (ev.kind === 'snapfull') audio.blip(1040, 0.26, 0.22);
    else if (ev.kind === 'snapgood') audio.blip(860, 0.20, 0.18);
    else if (ev.kind === 'snapok') audio.blip(700, 0.16, 0.15);
    else if (ev.kind === 'blown') audio.hit(150, 0.55, 0.45, 0.7);
    else if (ev.kind === 'pump') audio.blip(430, 0.13, 0.10);
    else if (ev.kind === 'brake') audio.hit(320, 0.30, 0.30, 1.6);
    else audio.blip(ev.kind === 'snap' ? 720 : 520, 0.14, 0.13);
  }

  /* --- world ----------------------------------------------------------- */
  waveMesh.update(surfer.s, surfer.b, t);
  rig.update(dt, sf, surfer, t);
  followWorld(world, rig.cam.position, t);

  rider.visible = true;
  if (surfer.alive) {
    rider.setBoard(TUNE.boardLen, TUNE.finPos);
    rider.update(sf, surfer.psi, surfer.lean, surfer.crouch, 0, surfer.w, surfer.tailPush);
  } else {
    rider.wipeout(surfer.tumble);
  }

  /* --- spray -----------------------------------------------------------
   * Only when a rail is actually engaged. Trimming in a straight line throws no water.
   */
  if (surfer.alive) {
    if (Math.abs(surfer.turnRate) > 0.42 && surfer.spd > 6) {
      spray.rail(sf, surfer.psi, surfer.turnRate, surfer.spd, 1);
    }
    /*
     * The tail letting go throws a sheet. spray.rail early-outs when its own `bite` term
     * hits zero, which happens at low speed and at the instant turnRate crosses zero — so
     * feed it the LATCHED snap direction and a floor speed instead of the live values, the
     * same synthetic-input trick the wipeout branch below uses.
     */
    if (surfer.snapT > 0) {
      spray.rail(sf, surfer.psi, surfer.snapDir * 2.0, Math.max(surfer.spd, 9),
        2 + Math.round(3 * surfer.snapQ));
    }
    if (surfer.snapT > 0 && !wasSnapping) {      // rising edge: one burst off the lip
      spray.lip(sf.px, sf.py + 0.45, sf.pz, sf.nx, sf.nz, 5 + Math.round(9 * surfer.snapQ));
    }
  } else if (surfer.tumble < 0.9 && Math.random() < 0.6) {
    spray.rail(sf, surfer.psi, 1.4, 12, 2);
  }
  // mist off the lip at the curl
  if (Math.random() < 0.4) {
    const bs = surfer.b + 2;
    const shp = wave.shape(bs, surfer.b, t, {});
    const f = wave.frame(bs);
    spray.lip(f.x + f.nx * shp.A * 0.4, shp.A * 1.05, f.z + f.nz * shp.A * 0.4, f.nx, f.nz, 2);
  }
  spray.update(dt);

  /* --- post-process mood ------------------------------------------------ */
  const wantDark = surfer.barreled ? 0.42 : 1;
  dark = approach(dark, wantDark, 6, dt);
  const wantTint = surfer.barreled ? 0.35 : clamp01(surfer.foamT * 0.8) * 0.5;
  tint = approach(tint, wantTint, 6, dt);
  pix.tint(surfer.barreled ? 0x0a3a4a : 0xdff2ff);
  pix.tintAmt = tint;
  pix.vignette = 0.34 + (surfer.barreled ? 0.9 : 0);

  /* --- end of ride ------------------------------------------------------ */
  if (!surfer.alive) {
    if (endT === 0) {
      audio.hit(surfer.state === STATE.WIPEOUT ? 180 : 420, 1.2, 0.6, 0.5);
    }
    endT += dt;
    pix.dark = dark * (1 - clamp01((endT - 1.1) / 1.4) * 0.55);
    if (endT > 2.0 && running) {
      running = false;
      hud.show(false);
      touch?.show(false);
      const total = surfer.score;
      hud.overlay(hud.results(surfer, wave, best));
      best = Math.max(best, total);
    }
  } else {
    pix.dark = dark;
  }

  hud.update(surfer, wave, dt);
  audio.update(surfer);
  pix.render(world.scene, rig.cam);
  diag(dt, 'RIDE');
  // Everything the substeps pushed has now been seen. Clearing here rather than inside
  // update() is what stops most events being thrown away — the physics runs several substeps
  // per frame, so a per-substep clear only ever delivered whatever the last one emitted.
  surfer.clearEvents();
}

/** Slowly orbiting attract shot behind the start card. */
let idleT = 0;
function renderIdle() {
  if (!world) { build(); }
  idleT += 0.016;
  const s = 40 + idleT * 4;
  const b = s - 6;
  wave.setAdvance(0);              // attract shot: peel only, no shoreward march
  waveMesh.update(s, b, idleT);
  const f = wave.frame(s);
  const y = 1.6 + Math.sin(idleT * 0.3) * 0.4;
  rig.cam.position.set(f.x - 16, y + 2.4, f.z + 9);
  rig.cam.up.set(0, 1, 0);
  rig.cam.lookAt(f.x + 24, 1.4, f.z - 2);
  rig.cam.fov = 66;
  rig.cam.updateProjectionMatrix();
  rider.visible = false;
  followWorld(world, rig.cam.position, idleT);
  spray.update(0.016);
  pix.dark = 1; pix.tintAmt = 0; pix.vignette = 0.34;
  pix.render(world.scene, rig.cam);
}

build();
requestAnimationFrame(frame);

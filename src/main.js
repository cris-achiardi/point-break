import * as THREE from 'three';
import { CFG } from './config.js';
import { Wave } from './wave.js';
import { Surfer, STATE } from './surfer.js';
import { Input } from './input.js';
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
  audio.start();
  hud.hideOverlay();
  hud.show(true);
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

/* ------------------------------------------------------------------- loop */

let last = performance.now();
let acc = 0;
const FIXED = 1 / 120;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running) { renderIdle(); return; }
  if (paused) return;

  const inp = input.sample();

  /* physics at a fixed step so hard turns stay stable */
  acc = Math.min(acc + dt, 0.1);
  while (acc >= FIXED) {
    surfer.update(FIXED, inp);
    acc -= FIXED;
  }

  surfer.surface(sf);
  const t = surfer.time;

  /* --- events --------------------------------------------------------- */
  for (const ev of surfer.events) {
    if (ev.kind === 'tube') audio.blip(880, 0.3, 0.2);
    else if (ev.kind === 'bounce') { audio.hit(240, 0.45, 0.42, 0.7); audio.blip(600, 0.2, 0.16); }
    else if (ev.kind === 'air' || ev.kind === 'land') audio.blip(1040, 0.22, 0.18);
    else audio.blip(ev.kind === 'snap' ? 720 : 520, 0.14, 0.13);
  }

  /* --- world ----------------------------------------------------------- */
  waveMesh.update(surfer.s, surfer.b, t);
  rig.update(dt, sf, surfer, t);
  followWorld(world, rig.cam.position, t);

  rider.visible = true;
  if (surfer.alive) {
    rider.setBoard(TUNE.boardLen, TUNE.finPos);
    rider.update(sf, surfer.psi, surfer.lean, surfer.crouch, surfer.airY, surfer.w, surfer.tailPush);
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
}

/** Slowly orbiting attract shot behind the start card. */
let idleT = 0;
function renderIdle() {
  if (!world) { build(); }
  idleT += 0.016;
  const s = 40 + idleT * 4;
  const b = s - 6;
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

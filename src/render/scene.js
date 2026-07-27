/**
 * Everything that is not the wave: sky, the flat ocean around it, the headland the point
 * wraps around, and the beach the wave is running toward.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { mulberry32 } from '../rng.js';

/*
 * Where the undisturbed sea sits, relative to the wave model's datum (the trough, at y = 0).
 * The mean is low enough that the ambient swell riding on it can never reach the datum, so the
 * open-ocean plane can never draw over the wave, the rider or the board. Keep
 * OCEAN_Y + OCEAN_SWELL comfortably negative if you retune these.
 */
export const OCEAN_Y = -0.62;
const OCEAN_SWELL = [0.10, 0.08, 0.18];   // sums to 0.36, so the crests top out at -0.26

export const SKY_TOP = 0x123a6b;
export const SKY_MID = 0x3f86c9;
export const SKY_LOW = 0xf2b878;
export const FOG_COL = 0x8ec3de;

const SKY_VERT = /* glsl */`
varying vec3 vPos;
void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const SKY_FRAG = /* glsl */`
precision mediump float;
uniform vec3 cTop, cMid, cLow;
varying vec3 vPos;
void main(){
  float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(cLow, cMid, smoothstep(0.46, 0.60, h));
  c = mix(c, cTop, smoothstep(0.58, 0.95, h));
  gl_FragColor = vec4(c, 1.0);
}
`;

function lowPoly(geo, colorFn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const col = colorFn(v, i);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

export function buildScene(wave) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COL, CFG.render.fogNear, CFG.render.fogFar);
  scene.background = new THREE.Color(FOG_COL);

  /* ---- sky dome ---- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 16, 10),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        cTop: { value: new THREE.Color(SKY_TOP) },
        cMid: { value: new THREE.Color(SKY_MID) },
        cLow: { value: new THREE.Color(SKY_LOW) },
      },
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  /* ---- sun, low and seaward ---- */
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(52, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false, depthWrite: false }),
  );
  sun.renderOrder = -1;
  scene.add(sun);

  /* ---- lights ---- */
  scene.add(new THREE.HemisphereLight(0xbfe4ff, 0x0a2a3a, 1.15));
  const key = new THREE.DirectionalLight(0xffe3b8, 1.5);
  key.position.set(-0.45, 0.62, 1).normalize();     // from the sun, out to sea
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x66d9ff, 0.55);
  rim.position.set(0.8, 0.25, -0.5).normalize();
  scene.add(rim);

  /* ---- open ocean ----
   * This plane is 1500 m across and anchored to the camera, so it passes UNDER the wave mesh
   * everywhere. The wave model's datum is its trough at y = 0 and nothing on the wave sits
   * below that, so the undisturbed sea has to stay strictly below it too. It used to sit at
   * -0.22 with 1.33 m of swell on it, which put its crests a metre OVER the trough — the flat
   * plane then drew across the base of the face and over the rider, and when a crest rolled
   * between the chase camera and the board it filled the frame and read as going underwater.
   */
  const N = 44, SPAN = 1500;
  const og = new THREE.PlaneGeometry(SPAN, SPAN, N, N).rotateX(-Math.PI / 2);
  const oceanBase = og.attributes.position.array.slice();
  const ocean = new THREE.Mesh(og, new THREE.MeshLambertMaterial({
    color: 0x11526b, flatShading: true,
  }));
  ocean.position.y = OCEAN_Y;
  ocean.frustumCulled = false;
  scene.add(ocean);

  /* ---- the point: rocks going back up the coast ---- */
  const rnd = mulberry32(7);
  const rocks = new THREE.Group();
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const geo = lowPoly(
      new THREE.DodecahedronGeometry(4 + rnd() * 9, 0),
      (v) => new THREE.Color().setHSL(0.08 + rnd() * 0.03, 0.14, 0.13 + Math.max(0, v.y) * 0.02 + rnd() * 0.05),
    );
    const m = new THREE.Mesh(geo, rockMat);
    const f = wave.frame(-40 - t * 240);
    const out = 14 + t * 46 + rnd() * 16;
    m.position.set(f.x + f.nx * out + (rnd() - 0.5) * 14, -1.5 + rnd() * 3.5, f.z + f.nz * out + (rnd() - 0.5) * 14);
    m.scale.set(1, 0.55 + rnd() * 0.7, 1);
    m.rotation.y = rnd() * 6;
    rocks.add(m);
  }
  // a headland hill behind the rocks
  const hill = lowPoly(
    new THREE.ConeGeometry(120, 62, 7, 1),
    (v) => new THREE.Color().setHSL(0.28, 0.22, 0.14 + v.y * 0.002),
  );
  const hm = new THREE.Mesh(hill, rockMat);
  const hf = wave.frame(-300);
  hm.position.set(hf.x + hf.nx * 60, 6, hf.z + hf.nz * 60);
  hm.scale.set(1.6, 1, 1.1);
  rocks.add(hm);
  scene.add(rocks);

  /* ---- beach + dunes, shoreward ---- */
  const shore = new THREE.Group();
  const sandMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const sg = new THREE.PlaneGeometry(2000, 300, 26, 4).rotateX(-Math.PI / 2);
  {
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      p.setY(i, Math.max(0, (z + 150) / 300) * 6 + Math.sin(p.getX(i) * 0.02) * 1.4);
    }
  }
  const sand = new THREE.Mesh(lowPoly(sg, (v) =>
    new THREE.Color().setHSL(0.11, 0.42, 0.56 + Math.min(0.16, v.y * 0.02))), sandMat);
  // everything shoreward is placed along -n, so it follows whichever way the face points
  const sf = wave.frame(wave.endS * 0.5);   // endS is derived by Wave, not a config constant
  sand.position.set(sf.x - sf.nx * 420, -0.6, sf.z - sf.nz * 420);
  sand.rotation.y = 0.12;
  shore.add(sand);

  const dunes = lowPoly(new THREE.ConeGeometry(180, 70, 6, 1), (v) =>
    new THREE.Color().setHSL(0.26, 0.3, 0.2 + v.y * 0.002));
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(dunes, sandMat);
    m.position.set(sf.x - sf.nx * 600 - 500 + i * 420, 2, sf.z - sf.nz * 600);
    m.scale.set(1.4 + i * 0.15, 0.5 + (i % 2) * 0.35, 1);
    shore.add(m);
  }
  scene.add(shore);

  /* ---- a few chunky clouds ---- */
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xfdf3e6, flatShading: true, fog: false });
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const n = 2 + ((rnd() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(16 + rnd() * 20, 0), cloudMat);
      b.position.set(k * 22 - n * 8, rnd() * 6, rnd() * 12);
      b.scale.set(1.5, 0.5, 1);
      g.add(b);
    }
    const a = rnd() * Math.PI * 2, r = 380 + rnd() * 320;
    g.position.set(Math.cos(a) * r, 90 + rnd() * 90, Math.sin(a) * r);
    scene.add(g);
  }

  return { scene, sky, sun, ocean, oceanBase, key };
}

/** Keep the sky, sun and ocean anchored to the camera so they never run out. */
export function followWorld(world, camPos, t) {
  world.sky.position.set(camPos.x, 0, camPos.z);

  // low sun out to sea, behind the wave, so the lip reads backlit
  world.sun.position.set(camPos.x - 300, 118, camPos.z + 780);
  world.sun.lookAt(camPos.x, 118, camPos.z);

  const gx = Math.round(camPos.x / 34) * 34;
  const gz = Math.round(camPos.z / 34) * 34;
  world.ocean.position.x = gx;
  world.ocean.position.z = gz;

  const p = world.ocean.geometry.attributes.position;
  const base = world.oceanBase;
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3] + gx, z = base[i * 3 + 2] + gz;
    p.array[i * 3 + 1] = Math.sin(x * 0.035 + t * 0.9) * OCEAN_SWELL[0]
      + Math.sin(z * 0.052 - t * 1.25) * OCEAN_SWELL[1]
      + Math.sin((x + z) * 0.011 + t * 0.4) * OCEAN_SWELL[2];
  }
  p.needsUpdate = true;
}

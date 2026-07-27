/**
 * The wave, as geometry.
 *
 * A treadmill: a fixed grid of (station, height) samples that always spans from ~70 m behind
 * the rider to ~230 m ahead. Every frame the grid is re-evaluated against the wave model at
 * absolute stations, so the wall ahead is genuinely being generated from the same shape
 * function the physics reads. Column spacing is dense near the board and coarse at the far
 * end, which is where the polygon budget wants to be anyway.
 *
 * Rows below u=0 are the inside water (already-broken, shoreward of the trough). Rows from
 * u=0..1 are the face. A second thin mesh drapes over the back of the wave from the apex so
 * the crest reads as solid against the sky.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { column, colAt, colBeta, colApexU, colTrough } from '../wave.js';
import { clamp01, lerp, smoothstep, hash2 } from '../rng.js';

const M = CFG.mesh;

// palette
const C_DEEP = [0.040, 0.180, 0.268];
const C_FACE = [0.055, 0.470, 0.520];
const C_LIP = [0.290, 0.900, 0.770];
const C_FOAM = [0.940, 0.990, 1.000];
const C_INSIDE = [0.115, 0.420, 0.470];
const C_BACK = [0.055, 0.230, 0.330];

function buildOffsets() {
  const o = [];
  for (let i = 0; i < M.nBack; i++) o.push(-M.back + M.back * Math.pow(i / (M.nBack - 1), 0.85));
  for (let i = 1; i <= M.nAhead; i++) o.push(M.ahead * Math.pow(i / M.nAhead, 1.5));
  return Float32Array.from(o);
}

function buildRows() {
  const u = [];
  for (const f of M.flatRows) u.push({ flat: f, u: 0 });
  for (let j = 0; j < M.nFace; j++) u.push({ flat: null, u: Math.pow(j / (M.nFace - 1), 0.88) });
  return u;
}

function grid(nc, nr) {
  const idx = [];
  for (let i = 0; i < nc - 1; i++) {
    for (let j = 0; j < nr - 1; j++) {
      const a = i * nr + j, b = a + nr;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return idx;
}

export class WaveMesh {
  constructor(wave, scene) {
    this.wave = wave;
    this.off = buildOffsets();
    this.rows = buildRows();
    this.NC = this.off.length;
    this.NR = this.rows.length;

    // ---- face + inside ----
    const n = this.NC * this.NR;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(grid(this.NC, this.NR));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // ---- back of the wave ----
    const nb = this.NC * M.nBackSkirt;
    this.bpos = new Float32Array(nb * 3);
    this.bcol = new Float32Array(nb * 3);
    const gb = new THREE.BufferGeometry();
    gb.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3).setUsage(THREE.DynamicDrawUsage));
    gb.setAttribute('color', new THREE.BufferAttribute(this.bcol, 3).setUsage(THREE.DynamicDrawUsage));
    gb.setIndex(grid(this.NC, M.nBackSkirt));
    gb.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.bgeo = gb;
    this.back = new THREE.Mesh(gb, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    }));
    this.back.frustumCulled = false;
    scene.add(this.back);

    // ---- foam ball churning at the curl ----
    const fg = new THREE.IcosahedronGeometry(1, 0);
    this.foam = new THREE.InstancedMesh(
      fg, new THREE.MeshLambertMaterial({ color: 0xeaf8ff, flatShading: true }), 34);
    this.foam.frustumCulled = false;
    this.foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.foam);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();

    this.sh = {};
  }

  /** Rebuild the whole strip around the rider. */
  update(riderS, b, t) {
    const wave = this.wave;
    const { pos, col, nrm, rows, off, NC, NR } = this;
    const bpos = this.bpos, bcol = this.bcol, NB = M.nBackSkirt;

    for (let i = 0; i < NC; i++) {
      const s = riderS + off[i];
      const sh = wave.shape(s, b, t, this.sh);
      column(sh.phi, sh.A);
      const f = wave.frame(s);
      const d = s - b;

      const apexU = colApexU();
      const apex = colAt(apexU);
      const apexRun = apex.run, apexHt = apex.ht;
      const troughRun = colTrough();     // inside water hangs off the (moving) trough

      const curl = Math.exp(-Math.pow((d - 1.2) / 4.2, 2));        // foam line at the curl
      const chop = sh.broken;
      const jit = hash2(Math.floor(s * 0.8), 7.1) * 6.28;

      const base = i * NR * 3;
      for (let j = 0; j < NR; j++) {
        const r = rows[j];
        const k = base + j * 3;

        let run, ht, u, beta;
        if (r.flat !== null) {
          u = 0;
          run = troughRun + r.flat;   // shoreward of the trough, which sits under the lip line
          beta = 0;
          // inside water: a lazy chop, plus churn where it has already broken
          ht = Math.sin(s * 0.09 + t * 1.1 + r.flat * 0.05) * 0.16
             + Math.sin(r.flat * 0.21 - t * 1.7) * 0.09
             + chop * (0.28 + 0.5 * hash2(Math.floor(s * 0.9), j + t * 2.2));
        } else {
          u = r.u;
          const p = colAt(u);
          run = p.run; ht = p.ht;
          beta = colBeta(u);
          if (chop > 0) {
            const n = hash2(Math.floor(s * 1.1) + j * 3, Math.floor(t * 7) * 0.37 + j);
            const amp = chop * (0.14 + 0.5 * u) * sh.A * 0.42;
            ht += (n - 0.5) * amp;
            run += (hash2(j * 5.3, Math.floor(s * 0.7)) - 0.5) * amp * 0.8;
          }
        }

        pos[k] = f.x + f.nx * run;
        pos[k + 1] = ht;
        pos[k + 2] = f.z + f.nz * run;

        // analytic surface normal: uface x t  (see the handedness note in Wave.frame)
        const cb = Math.cos(beta), sb = Math.sin(beta);
        const ux = f.nx * cb, uy = sb, uz = f.nz * cb;
        let nx = uy * f.tz, ny = uz * f.tx - ux * f.tz, nz = -uy * f.tx;
        const il = 1 / (Math.hypot(nx, ny, nz) || 1);
        nrm[k] = nx * il; nrm[k + 1] = ny * il; nrm[k + 2] = nz * il;

        /* ---- colour ---- */
        let cr, cg, cbl;
        if (r.flat !== null) {
          const fo = clamp01(chop * 1.3 + curl * 0.5 * (1 + r.flat / 60));
          cr = lerp(C_INSIDE[0], C_FOAM[0], fo);
          cg = lerp(C_INSIDE[1], C_FOAM[1], fo);
          cbl = lerp(C_INSIDE[2], C_FOAM[2], fo);
          cr *= 0.92; cg *= 0.94; cbl *= 0.96;
        } else {
          const lo = smoothstep(0.0, 0.5, u);
          cr = lerp(C_DEEP[0], C_FACE[0], lo);
          cg = lerp(C_DEEP[1], C_FACE[1], lo);
          cbl = lerp(C_DEEP[2], C_FACE[2], lo);
          // the lip goes thin and backlit
          const hi = smoothstep(0.52, 1.0, u) * (0.45 + 0.55 * sh.hollow) * sh.stand;
          cr = lerp(cr, C_LIP[0], hi);
          cg = lerp(cg, C_LIP[1], hi);
          cbl = lerp(cbl, C_LIP[2], hi);
          // white water at the curl and behind it
          const fo = clamp01(curl * smoothstep(0.45, 0.95, u) * 0.95
            + chop * (0.45 + 0.55 * smoothstep(0.05, 0.6, u)));
          cr = lerp(cr, C_FOAM[0], fo);
          cg = lerp(cg, C_FOAM[1], fo);
          cbl = lerp(cbl, C_FOAM[2], fo);
          // shadow thrown by an overhanging lip — the apex sticks out seaward over the face
          if (apexRun > run + 0.2 && u < apexU) {
            const sd = clamp01((apexRun - run) / (sh.A * 0.9)) * 0.5;
            cr *= 1 - sd; cg *= 1 - sd * 0.85; cbl *= 1 - sd * 0.7;
          }
          // water racing up the face
          const st = 0.05 * Math.sin(u * 12.0 - t * 3.0 + s * 0.32 + jit);
          cr += st; cg += st; cbl += st;
        }
        col[k] = cr; col[k + 1] = cg; col[k + 2] = cbl;
      }

      /* ---- back skirt from the apex, seaward and down ---- */
      const bb = i * NB * 3;
      for (let j = 0; j < NB; j++) {
        const t2 = j / (NB - 1);
        const run = apexRun + t2 * t2 * 62 + t2 * 3;
        const ht = apexHt * Math.pow(1 - t2, 1.7) + Math.sin(s * 0.08 + t * 1.0) * 0.12 * t2;
        const k = bb + j * 3;
        bpos[k] = f.x + f.nx * run;
        bpos[k + 1] = ht;
        bpos[k + 2] = f.z + f.nz * run;
        const shade = lerp(1.0, 0.62, t2);
        const fo = chop * 0.5 * (1 - t2);
        bcol[k] = lerp(C_BACK[0] * shade, C_FOAM[0], fo);
        bcol[k + 1] = lerp(C_BACK[1] * shade, C_FOAM[1], fo);
        bcol[k + 2] = lerp(C_BACK[2] * shade, C_FOAM[2], fo);
      }
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.bgeo.attributes.position.needsUpdate = true;
    this.bgeo.attributes.color.needsUpdate = true;

    this._foamBall(b, t);
  }

  /** Chunky churn right where the wave is breaking. */
  _foamBall(b, t) {
    const wave = this.wave;
    const n = this.foam.count;
    for (let i = 0; i < n; i++) {
      const q = i / n;
      const s = b + 2.5 - q * 26;
      const sh = wave.shape(s, b, t, this.sh);
      column(sh.phi, sh.A);
      const f = wave.frame(s);
      const h1 = hash2(i * 1.7, Math.floor(t * 3) * 0.11);
      const h2 = hash2(i * 3.3 + 5, Math.floor(t * 3) * 0.19);
      const u = 0.15 + 0.55 * h1 * (1 - q * 0.5);
      const p = colAt(u);
      const wob = Math.sin(t * 5 + i) * 0.3;
      const run = p.run + (h2 - 0.5) * 2.4 - q * 3.0;
      this._v.set(f.x + f.nx * run + wob, p.ht * 0.85 + h2 * 0.5, f.z + f.nz * run);
      const sc = (0.55 + h1 * 0.95) * (1.15 - q * 0.55) * Math.max(0.3, sh.A / 2.6);
      this._sc.set(sc, sc * 0.8, sc);
      this._q.set(h1, h2, h1 * h2, 1).normalize();
      this._m.compose(this._v, this._q, this._sc);
      this.foam.setMatrixAt(i, this._m);
    }
    this.foam.instanceMatrix.needsUpdate = true;
  }
}

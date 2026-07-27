/**
 * Board and rider — deliberately about 120 triangles of chunky boxes.
 * Oriented from the analytic surface frame so the board actually lies on the face and
 * banks into its own turns.
 */
import * as THREE from 'three';
import { clamp, lerp } from '../rng.js';

/** How much of the face's tilt the rider stands back up against. 1 = bolt upright. */
const STAND = 0.80;

const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });

function box(w, h, d, hex, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex));
  m.position.set(x, y, z);
  return m;
}

/**
 * A tapered surfboard. The rig's basis maps local +Z to *backward* (makeBasis needs
 * r x u = -forward), so the NOSE lives at -Z and the tail at +Z. Getting this backwards
 * puts the fin at the front.
 */
function boardGeo(len) {
  const g = new THREE.BoxGeometry(0.52, 0.07, len, 1, 1, 6);
  const p = g.attributes.position;
  const half = len * 0.5;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = Math.abs(z) / half;
    const pinch = 1 - Math.pow(t, 2.1) * 0.92;
    p.setX(i, p.getX(i) * pinch);
    p.setY(i, p.getY(i) * (1 - Math.pow(t, 3) * 0.5));
    // rocker, stronger through the nose
    p.setY(i, p.getY(i) + Math.pow(t, 2.4) * 0.11 * (z < 0 ? 1.5 : 1));
  }
  g.computeVertexNormals();
  return g;
}

export class Rider {
  constructor(scene) {
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();     // roll from leaning
    this.root.add(this.tilt);

    this.board = new THREE.Group();
    this.tilt.add(this.board);
    const deck = new THREE.Mesh(boardGeo(1), mat(0xf3f6f8));
    const stripe = new THREE.Mesh(boardGeo(1), mat(0xff6a3d));
    stripe.scale.set(0.34, 1.06, 0.99);
    stripe.position.y = 0.005;
    this.board.add(deck, stripe);

    /*
     * Fins hang off `tilt`, NOT off the deck group — the deck is scaled by board length,
     * so anything parented to it gets its offset multiplied by the length a second time
     * and stretches with it. A thruster: centre fin back, two smaller sides slightly ahead
     * and canted out.
     */
    this.fins = new THREE.Group();
    this.tilt.add(this.fins);
    const sideL = box(0.035, 0.14, 0.13, 0x2b2f38, -0.17, -0.09, -0.10);
    const sideR = box(0.035, 0.14, 0.13, 0x2b2f38, 0.17, -0.09, -0.10);
    sideL.rotation.z = 0.24;
    sideR.rotation.z = -0.24;
    this.fins.add(box(0.045, 0.20, 0.17, 0x2b2f38, 0, -0.12, 0), sideL, sideR);

    // rider stands on the deck and walks it; +Z is the tail, -Z the nose
    this.body = new THREE.Group();
    this.body.position.set(0, 0.06, 0.1);
    this.tilt.add(this.body);

    const suit = 0x1c2740, skin = 0xd9a066, hair = 0x2a1c14;
    this.legs = new THREE.Group();
    this.frontFoot = box(0.16, 0.52, 0.2, suit, -0.15, 0.28, -0.34);
    this.backFoot = box(0.16, 0.52, 0.2, suit, 0.13, 0.28, 0.36);
    this.legs.add(this.frontFoot, this.backFoot);
    this.body.add(this.legs);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.54;
    this.torso.add(box(0.36, 0.5, 0.24, suit, 0, 0.23, 0));
    this.torso.add(box(0.22, 0.22, 0.2, skin, 0, 0.6, 0.02));
    this.torso.add(box(0.235, 0.1, 0.21, hair, 0, 0.69, -0.01));
    this.armL = box(0.12, 0.42, 0.12, skin, -0.24, 0.28, 0.06);
    this.armR = box(0.12, 0.42, 0.12, skin, 0.24, 0.28, 0.06);
    this.torso.add(this.armL, this.armR);
    this.body.add(this.torso);

    scene.add(this.root);

    this._f = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._wu = new THREE.Vector3();
    this._iq = new THREE.Quaternion();
  }

  /**
   * @param sf  surface sample from Surfer.surface()
   * @param psi board heading on the face
   * @param lean roll, -1..1
   * @param crouch 0..1
   */
  /** Board length is a live tunable, so the mesh follows it. */
  setBoard(len, finPos) {
    if (this._len === len && this._fin === finPos) return;
    this._len = len; this._fin = finPos;
    this.board.scale.z = len;
    // the deck runs -len/2 (nose) to +len/2 (tail); fins sit in the back quarter
    this.fins.position.z = len * (0.30 + 0.16 * finPos);
    this._reach = len * 0.26;      // how far along the deck the stance can walk
  }

  update(sf, psi, lean, crouch, airY, stance = 0, tailPush = 0) {
    // heading on the surface: along the line rotated toward the lip by psi
    const cp = Math.cos(psi), sp = Math.sin(psi);
    this._f.set(sf.tx * cp + sf.ux * sp, sf.ty * cp + sf.uy * sp, sf.tz * cp + sf.uz * sp).normalize();
    this._u.set(sf.nx, sf.ny, sf.nz);
    this._r.crossVectors(this._f, this._u).normalize();
    this._u.crossVectors(this._r, this._f).normalize();

    this.root.position.set(sf.px, sf.py + 0.07, sf.pz);
    this._m.makeBasis(this._r, this._u, this._f.clone().negate());
    this.root.quaternion.setFromRotationMatrix(this._m);

    this.tilt.rotation.z = lean * 0.75;
    this.tilt.rotation.x = clamp(-lean * 0.06, -0.1, 0.1);

    /*
     * The board lies on the face, but the RIDER does not. You stand up against gravity and
     * let the rail hold you — you are only laid over sideways mid-turn. So find how far
     * world-up has been rotated away inside the board's frame, and stand the body back up
     * against most of it. Without this the rider leans out of the wave like a snowboarder.
     */
    this._iq.copy(this.root.quaternion).invert();
    this._wu.set(0, 1, 0).applyQuaternion(this._iq);
    const rollBack = Math.atan2(-this._wu.x, this._wu.y);
    this.body.rotation.z = (rollBack - this.tilt.rotation.z) * STAND;

    /*
     * Walk the deck. Stance +1 is forward over the nose, -1 is back over the fins, and the
     * feet actually travel — on a long board that is a real trip up and down the plank.
     */
    const reach = this._reach || 0.6;
    this.body.position.z = 0.1 - stance * reach;
    // stamping the tail sinks it and lifts the nose; walking forward does the opposite
    this.board.rotation.x = tailPush * 0.14 - stance * 0.05;
    // the trailing foot closes up as you step forward, and splays as you drop back
    this.backFoot.position.z = 0.36 - stance * 0.10;
    this.frontFoot.position.z = -0.34 - stance * 0.04;

    const c = crouch;
    this.body.position.y = 0.06 - c * 0.16;
    this.legs.scale.y = 1 - c * 0.34;
    this.torso.position.y = 0.54 - c * 0.2;
    this.torso.rotation.x = 0.12 + c * 0.42;
    this.torso.rotation.y = lean * -0.4;
    this.armL.rotation.z = 0.5 + lean * 1.5 + c * 0.35;
    this.armR.rotation.z = -0.5 + lean * 1.5 - c * 0.35;
    this.armL.rotation.x = -0.3 - c * 0.4;
    this.armR.rotation.x = -0.1 + lean * 0.6;
  }

  /** Ragdoll-ish flail after eating it. */
  wipeout(t) {
    this.tilt.rotation.z += 3.2 * 0.016;
    this.tilt.rotation.x += 2.1 * 0.016;
    this.root.position.y -= Math.min(1.6, t * 1.1) * 0.02;
    this.torso.rotation.x = Math.sin(t * 9) * 0.9;
    this.armL.rotation.z = 0.5 + Math.sin(t * 12) * 1.8;
    this.armR.rotation.z = -0.5 + Math.cos(t * 11) * 1.8;
  }

  set visible(v) { this.root.visible = v; }
}

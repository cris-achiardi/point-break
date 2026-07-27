/**
 * Two cameras over the same rig. Both look down the line with the face filling the left of
 * the frame — the view you actually get standing on a right-hander, rather than the
 * from-the-beach view every other surf game uses.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, clamp01, lerp, approach } from '../rng.js';

export const CAM = { CHASE: 0, POV: 1 };

export class CameraRig {
  constructor(aspect) {
    this.cam = new THREE.PerspectiveCamera(CFG.render.fov, aspect, 0.12, CFG.render.far);
    this.mode = CAM.CHASE;
    this.eye = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this._e = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this.shake = 0;
    this.first = true;
  }

  toggle() { this.mode = this.mode === CAM.CHASE ? CAM.POV : CAM.CHASE; }

  update(dt, sf, surfer, t) {
    // The board can swing all the way back up the line on a cutback; the camera should
    // lean into that but never reverse, or the view whips around behind you.
    const camPsi = clamp(surfer.psi, -1.15, 1.15);
    const cp = Math.cos(camPsi), sp = Math.sin(camPsi);
    // heading along the surface
    const fx = sf.tx * cp + sf.ux * sp, fy = sf.ty * cp + sf.uy * sp, fz = sf.tz * cp + sf.uz * sp;
    // blend the board heading toward "straight down the line" so the camera does not
    // whip around on every pump
    const bl = this.mode === CAM.POV ? 0.55 : 0.42;
    let hx = lerp(sf.tx, fx, bl), hy = lerp(sf.ty, fy, bl), hz = lerp(sf.tz, fz, bl);
    const hl = 1 / (Math.hypot(hx, hy, hz) || 1); hx *= hl; hy *= hl; hz *= hl;

    const n = { x: sf.nx, y: sf.ny, z: sf.nz };
    // bias the aim up the face so the wall stays in frame
    const uf = { x: sf.ux, y: sf.uy, z: sf.uz };

    if (this.mode === CAM.POV) {
      this._e.set(
        sf.px + n.x * 1.62 + hx * 0.15,
        sf.py + n.y * 1.62 + hy * 0.15 + 0.05,
        sf.pz + n.z * 1.62 + hz * 0.15,
      );
      this._a.set(
        sf.px + hx * 16 + uf.x * 3.4 + n.x * 1.2,
        sf.py + hy * 16 + uf.y * 3.4 + n.y * 1.2,
        sf.pz + hz * 16 + uf.z * 3.4 + n.z * 1.2,
      );
    } else {
      const back = 4.4 + clamp01(surfer.spd / 20) * 1.6;
      this._e.set(
        sf.px - hx * back + n.x * 2.15,
        sf.py - hy * back + n.y * 2.15,
        sf.pz - hz * back + n.z * 2.15,
      );
      this._a.set(
        sf.px + hx * 11 + uf.x * 3.0 + n.x * 1.1,
        sf.py + hy * 11 + uf.y * 3.0 + n.y * 1.1,
        sf.pz + hz * 11 + uf.z * 3.0 + n.z * 1.1,
      );
    }

    // keep the lens above water
    this._e.y = Math.max(this._e.y, 0.55);

    if (this.first) { this.eye.copy(this._e); this.aim.copy(this._a); this.first = false; }
    const k = this.mode === CAM.POV ? 16 : 11;
    this.eye.x = approach(this.eye.x, this._e.x, k, dt);
    this.eye.y = approach(this.eye.y, this._e.y, k * 0.8, dt);
    this.eye.z = approach(this.eye.z, this._e.z, k, dt);
    this.aim.x = approach(this.aim.x, this._a.x, k * 0.85, dt);
    this.aim.y = approach(this.aim.y, this._a.y, k * 0.7, dt);
    this.aim.z = approach(this.aim.z, this._a.z, k * 0.85, dt);

    // bank with the turn, but stay mostly world-up so the horizon reads
    const bank = clamp(-surfer.turnRate * 0.16 + surfer.lean * 0.1, -0.3, 0.3);
    this._u.set(0, 1, 0).lerp(this._n.set(n.x, n.y, n.z), 0.22);
    this._u.applyAxisAngle(this._h.set(hx, hy, hz).normalize(), bank);
    this.up.lerp(this._u, 1 - Math.exp(-8 * dt));

    // shake: foam, wipeouts, raw speed
    this.shake = approach(this.shake,
      clamp01(surfer.foamT * 1.4) * 0.5 + clamp01((surfer.spd - 13) / 12) * 0.12
      + (surfer.alive ? 0 : 0.7), 10, dt);
    const sk = this.shake * 0.13;
    const jx = Math.sin(t * 47.3) * sk, jy = Math.cos(t * 41.7) * sk;

    this.cam.position.copy(this.eye);
    this.cam.position.x += jx; this.cam.position.y += jy;
    this.cam.up.copy(this.up).normalize();
    this.cam.lookAt(this.aim);

    const targetFov = CFG.render.fov + surfer.spd * CFG.render.fovSpeed
      + (surfer.barreled ? -4 : 0);
    this.cam.fov = approach(this.cam.fov, clamp(targetFov, 60, 78), 4, dt);
    this.cam.updateProjectionMatrix();
  }

  resize(aspect) {
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
  }
}

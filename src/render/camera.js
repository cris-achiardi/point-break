/**
 * Two cameras over the same rig. Both look down the line with the face filling the left of
 * the frame — the view you actually get standing on a right-hander, rather than the
 * from-the-beach view every other surf game uses.
 */
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, clamp01, approach } from '../rng.js';

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
    this.yaw = 0;                       // camera bearing, eased toward the travel direction
    this._tvx = 1; this._tvz = 0;       // last good travel direction
    this._lpx = 0; this._lpz = 0;       // last board position, for the velocity estimate
  }

  toggle() { this.mode = this.mode === CAM.CHASE ? CAM.POV : CAM.CHASE; }

  update(dt, sf, surfer, t) {
    const px = sf.px, py = sf.py, pz = sf.pz;

    /*
     * A real world-space follow camera that tracks the BOARD DIRECTION — where the nose is
     * actually pointed — not the surfer's world velocity (which is dragged diagonally
     * shoreward by the wave carrying you, and left the camera stuck on an angle). The board
     * heading comes from the wave frame plus psi. We ease a camera yaw toward it along the
     * SHORTEST arc and damp it, so it follows turns cleanly and a cutback swings round
     * smoothly instead of snapping/flipping the way it used to.
     */
    const tx = sf.tx, tz = sf.tz;              // along-the-line tangent (horizontal)
    const nxh = -tz, nzh = tx;                 // seaward normal (up the face), horizontal
    const cp = Math.cos(surfer.psi), sp = Math.sin(surfer.psi);
    let bx = tx * cp + nxh * sp;               // board heading in the world, horizontal
    let bz = tz * cp + nzh * sp;
    const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;

    if (this.first) this.yaw = Math.atan2(bz, bx);
    const targetYaw = Math.atan2(bz, bx);
    let dyaw = targetYaw - this.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));            // shortest way round
    const yawK = this.mode === CAM.POV ? 5.0 : 4.4;              // follows the board; damped, no snap
    this.yaw += dyaw * (1 - Math.exp(-yawK * dt));
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);      // horizontal forward

    // seaward (up-the-face) horizontal direction — keeps the wall in frame
    const ex = nxh, ez = nzh;

    if (this.mode === CAM.POV) {
      this._e.set(px + fx * 0.12, py + 1.55, pz + fz * 0.12);
      this._a.set(px + fx * 16 + ex * 3.0, py + 3.0, pz + fz * 16 + ez * 3.0);
    } else {
      // Sit DIRECTLY behind the nose (no sideways offset toward the wall) so the board points
      // straight into the screen, raised a little. Look ahead along the board heading with a
      // small up-face lift so the wall still frames — the same view as the helmet cam, pulled
      // back behind the rider.
      const back = 5.5 + clamp01(surfer.spd / 20) * 2.2;
      this._e.set(px - fx * back, py + 2.3, pz - fz * back);
      this._a.set(px + fx * 9 + ex * 1.4, py + 1.4, pz + fz * 9 + ez * 1.4);
    }

    // keep the lens above water
    this._e.y = Math.max(this._e.y, 0.6);

    if (this.first) { this.eye.copy(this._e); this.aim.copy(this._a); this.first = false; }
    const k = this.mode === CAM.POV ? 14 : 9;
    this.eye.x = approach(this.eye.x, this._e.x, k, dt);
    this.eye.y = approach(this.eye.y, this._e.y, k * 0.8, dt);
    this.eye.z = approach(this.eye.z, this._e.z, k, dt);
    this.aim.x = approach(this.aim.x, this._a.x, k * 0.9, dt);
    this.aim.y = approach(this.aim.y, this._a.y, k * 0.75, dt);
    this.aim.z = approach(this.aim.z, this._a.z, k * 0.9, dt);

    // up: world-up with a slight bank into the turn so the horizon stays readable
    const bank = clamp(-surfer.turnRate * 0.14, -0.28, 0.28);
    this._u.set(0, 1, 0).applyAxisAngle(this._h.set(fx, 0, fz).normalize(), bank);
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

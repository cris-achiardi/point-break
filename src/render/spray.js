/**
 * Chunky point spray. At 240p a gl_Point is already a fat pixel cluster, which is exactly
 * the era-appropriate particle.
 */
import * as THREE from 'three';

const MAX = 520;

export class Spray {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.head = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = g;

    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.24, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.95, depthWrite: false, fog: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // park everything below the world until it is used
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -9999;
  }

  emit(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.head; this.head = (this.head + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
  }

  /**
   * Water thrown off the engaged rail. A board does not fountain foam out of its tail into
   * your own eyeline — water is deflected sideways off the buried rail, so this emits from
   * the inside rail and throws laterally, away from the board.
   */
  rail(sf, psi, turnRate, spd, n) {
    const cp = Math.cos(psi), sp = Math.sin(psi);
    const fx = sf.tx * cp + sf.ux * sp, fy = sf.ty * cp + sf.uy * sp, fz = sf.tz * cp + sf.uz * sp;
    const dir = Math.sign(turnRate) || 1;
    // rail direction = heading x normal (points out to the side of the board)
    const rx = fy * sf.nz - fz * sf.ny;
    const ry = fz * sf.nx - fx * sf.nz;
    const rz = fx * sf.ny - fy * sf.nx;

    const bite = Math.min(1, (Math.abs(turnRate) - 0.3) / 1.0) * Math.min(1, spd / 10);
    if (bite <= 0) return;
    const v = (2.0 + spd * 0.30) * bite;

    for (let k = 0; k < n; k++) {
      const j = () => (Math.random() - 0.5) * 2;
      // start on the buried rail, level with the deck, a little behind the front foot
      this.emit(
        sf.px - fx * 0.35 + rx * dir * 0.28,
        sf.py + 0.04,
        sf.pz - fz * 0.35 + rz * dir * 0.28,
        (rx * dir * 1.5 + sf.nx * 0.35) * v + j() * 0.7,
        (ry * dir * 1.5 + sf.ny * 0.35 + 0.75) * v * 0.5 + j() * 0.4,
        (rz * dir * 1.5 + sf.nz * 0.35) * v + j() * 0.7,
        0.28 + Math.random() * 0.32, 0.92, 0.99, 1.0,
      );
    }
  }

  /** Mist blowing off the lip. */
  lip(x, y, z, nx, nz, n) {
    for (let k = 0; k < n; k++) {
      const j = () => (Math.random() - 0.5) * 2;
      this.emit(x + j() * 3.5, y + Math.random() * 0.9, z + j() * 3.5,
        nx * (1.5 + Math.random() * 2.5) + j(), 1.4 + Math.random() * 2.2, nz * (1.5 + Math.random() * 2.5) + j(),
        0.7 + Math.random() * 0.8, 0.95, 1.0, 1.0);
    }
  }

  update(dt) {
    const { pos, vel, life, max, col } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { pos[i * 3 + 1] = -9999; continue; }
      vel[i * 3 + 1] -= 11 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const f = life[i] / max[i];
      col[i * 3] = 0.92 * f + 0.25; col[i * 3 + 1] = 0.99 * f + 0.3; col[i * 3 + 2] = f + 0.35;
      if (pos[i * 3 + 1] < -0.4) { life[i] = 0; pos[i * 3 + 1] = -9999; }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

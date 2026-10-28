import * as THREE from 'three';
import { getTextures } from './textures.js';

const MAX_PARTICLES = 900;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = (this.scene = game.scene);

    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5); // lookAt points +z at the target
    this.tracers = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0 });
    }
    this.tracerIdx = 0;

    this.particleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.particleMesh.setColorAt(0, _c.setHex(0xffffff));
    scene.add(this.particleMesh);
    this.particles = [];

    const glow = getTextures().glow;
    this.sprites = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffcc66, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.sprites.push({ sprite: s, life: 0, max: 0, size: 1, grow: 0 });
    }
    this.spriteIdx = 0;

    this.shells = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.shells.push({ mesh: m, life: 0, max: 0, radius: 1 });
    }
    this.shellIdx = 0;
  }

  tracer(from, to, color = 0xffe08a, width = 0.035, life = 0.07) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.max = life;
  }

  flash(pos, color = 0xffcc66, size = 0.8, life = 0.06, grow = 0) {
    const s = this.sprites[this.spriteIdx];
    this.spriteIdx = (this.spriteIdx + 1) % this.sprites.length;
    s.sprite.position.copy(pos);
    s.sprite.material.color.setHex(color);
    s.sprite.material.opacity = 1;
    s.sprite.scale.setScalar(size);
    s.sprite.visible = true;
    s.life = s.max = life;
    s.size = size;
    s.grow = grow;
  }

  particle(x, y, z, vx, vy, vz, color, size, life, gravity = 1) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      x, y, z, vx, vy, vz, color, size, life, max: life, gravity,
      rx: Math.random() * 6, ry: Math.random() * 6, rv: (Math.random() - 0.5) * 12,
    });
  }

  burst(pos, color, count = 10, speed = 4, size = 0.15, gravity = 1, life = 0.8) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.particle(pos.x, pos.y, pos.z, Math.cos(a) * r * s, Math.abs(u) * s + speed * 0.3, Math.sin(a) * r * s,
        color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  impact(pos, color = 0xdddddd) {
    this.burst(pos, color, 4, 3, 0.07, 1, 0.35);
    this.flash(pos, 0xfff0c0, 0.35, 0.05);
  }

  debris(center, color, b) {
    for (let i = 0; i < 16; i++) {
      const x = b.minX + Math.random() * (b.maxX - b.minX);
      const y = b.minY + Math.random() * (b.maxY - b.minY);
      const z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      this.particle(x, y, z, (x - center.x) * 1.5 + (Math.random() - 0.5) * 2, Math.random() * 4, (z - center.z) * 1.5 + (Math.random() - 0.5) * 2,
        color, 0.25 + Math.random() * 0.35, 1.0 + Math.random() * 0.6, 1);
    }
  }

  explosion(pos, radius) {
    const sh = this.shells[this.shellIdx];
    this.shellIdx = (this.shellIdx + 1) % this.shells.length;
    sh.mesh.position.copy(pos);
    sh.mesh.visible = true;
    sh.radius = radius;
    sh.life = sh.max = 0.35;
    this.flash(pos, 0xffaa33, radius * 2.5, 0.3, 2);
    this.burst(pos, 0xff8a2a, 26, 12, 0.3, 0.6, 0.9);
    this.burst(pos, 0x555555, 18, 6, 0.5, -0.15, 1.6);
  }

  elimination(pos) {
    for (let i = 0; i < 40; i++) {
      this.particle(pos.x + (Math.random() - 0.5) * 0.8, pos.y + Math.random() * 1.9, pos.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 1.5,
        Math.random() < 0.5 ? 0x5ee7ff : 0x2a8cff, 0.12 + Math.random() * 0.12, 1.4 + Math.random(), -0.25);
    }
    this.flash(pos.clone().setY(pos.y + 1), 0x6ee8ff, 3, 0.4, 1);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = 0.9 * (t.life / t.max);
    }
    for (const s of this.sprites) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sprite.visible = false; continue; }
      const k = s.life / s.max;
      s.sprite.material.opacity = k;
      s.sprite.scale.setScalar(s.size * (1 + (1 - k) * s.grow));
    }
    for (const sh of this.shells) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0) { sh.mesh.visible = false; continue; }
      const k = 1 - sh.life / sh.max;
      sh.mesh.scale.setScalar(sh.radius * (0.3 + k * 0.9));
      sh.mesh.material.opacity = 0.7 * (1 - k);
    }

    const P = this.particles;
    let w = 0;
    const mesh = this.particleMesh;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 18 * p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rx += p.rv * dt;
      const k = Math.min(1, (p.life / p.max) * 2.5);
      _p.set(p.x, p.y, p.z);
      _q.setFromEuler(_e.set(p.rx, p.ry, p.rx * 0.7));
      _s.setScalar(p.size * k);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(w, _m);
      mesh.setColorAt(w, _c.setHex(p.color));
      P[w++] = p;
    }
    P.length = w;
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

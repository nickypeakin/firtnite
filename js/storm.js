import * as THREE from 'three';
import { STORM } from './config.js';
import { lerp } from './util.js';

export class Storm {
  constructor(game, rng) {
    this.game = game;
    this.rng = rng;
    this.phases = STORM.phases;
    this.phaseIdx = 0;
    this.cur = { x: 0, z: 0, r: STORM.startRadius };
    this.from = { ...this.cur };
    this.next = this.pickNext(this.cur, this.phases[0].radius);
    this.state = 'wait';
    this.timer = this.phases[0].wait;
    this.tickT = 1;
    this.time = 0;

    const geo = new THREE.CylinderGeometry(1, 1, 420, 128, 1, true);
    geo.translate(0, 190, 0);
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0x9b3cff) } },
      vertexShader: `varying vec2 vUv; varying float vY; varying vec3 vWorld;
        void main(){ vUv = uv; vY = position.y; vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float time; uniform vec3 color; varying vec2 vUv; varying float vY; varying vec3 vWorld;
        void main(){
          float s1 = sin(vUv.x * 420.0 + vY * 0.08 - time * 1.4) * 0.5 + 0.5;
          float s2 = sin(vUv.x * 160.0 - vY * 0.03 + time * 0.8) * 0.5 + 0.5;
          float a = 0.30 + 0.18 * s1 * s2;
          a *= 1.0 - smoothstep(0.75, 1.0, vUv.y);
          a *= 1.0 - 0.75 * smoothstep(220.0, 650.0, distance(vWorld, cameraPosition));
          vec3 c = color + vec3(0.25, 0.1, 0.35) * s1 * s2;
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    game.scene.add(this.mesh);
    this.syncMesh();
  }

  pickNext(cur, r) {
    const T = this.game.terrain;
    for (let i = 0; i < 80; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const d = this.rng.float(0, Math.max(0, cur.r - r) * 0.9);
      const x = cur.x + Math.cos(a) * d, z = cur.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > 190) continue;
      if (T.height(x, z) < 1.5 && r < 60) continue;
      return { x, z, r };
    }
    return { x: cur.x, z: cur.z, r };
  }

  get phase() {
    return this.phases[Math.min(this.phaseIdx, this.phases.length - 1)];
  }

  get damage() {
    return this.phase.dmg;
  }

  isOutside(x, z) {
    return Math.hypot(x - this.cur.x, z - this.cur.z) > this.cur.r;
  }

  insideNext(x, z, margin = 0) {
    return Math.hypot(x - this.next.x, z - this.next.z) < this.next.r - margin;
  }

  label() {
    if (this.state === 'wait') return { text: 'Storm in', time: this.timer };
    if (this.state === 'shrink') return { text: 'Storm closing', time: this.timer };
    return { text: 'Final storm', time: 0 };
  }

  update(dt) {
    this.time += dt;
    this.material.uniforms.time.value = this.time;
    if (this.state !== 'done') {
      this.timer -= dt;
      if (this.state === 'wait' && this.timer <= 0) {
        this.state = 'shrink';
        this.timer = this.phase.shrink;
        this.from = { ...this.cur };
        this.game.hud.centerMessage('The storm is closing in!', 3, 'storm');
      }
      if (this.state === 'shrink') {
        const k = 1 - Math.max(0, this.timer) / this.phase.shrink;
        this.cur.x = lerp(this.from.x, this.next.x, k);
        this.cur.z = lerp(this.from.z, this.next.z, k);
        this.cur.r = lerp(this.from.r, this.next.r, k);
        if (this.timer <= 0) {
          this.cur = { ...this.next };
          this.phaseIdx++;
          if (this.phaseIdx < this.phases.length) {
            this.next = this.pickNext(this.cur, this.phases[this.phaseIdx].radius);
            this.state = 'wait';
            this.timer = this.phase.wait;
            this.game.hud.centerMessage('New storm circle appearing', 3, 'storm');
          } else {
            this.phaseIdx = this.phases.length - 1;
            this.state = 'done';
          }
        }
      }
    }
    this.syncMesh();

    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 1;
      for (const ch of this.game.characters) {
        if (!ch.alive || ch.state === 'bus') continue;
        if (this.isOutside(ch.pos.x, ch.pos.z)) {
          this.game.applyDamage(ch, this.damage, null, { storm: true, ignoreShield: true, weapon: 'the Storm' });
          if (ch.isPlayer) this.game.audio.play('storm');
        }
      }
    }
  }

  syncMesh() {
    // The first circle starts out over the ocean; show the wall once it moves in.
    this.mesh.visible = !(this.phaseIdx === 0 && this.state === 'wait');
    const r = Math.max(0.05, this.cur.r);
    this.mesh.scale.set(r, 1, r);
    this.mesh.position.set(this.cur.x, -30, this.cur.z);
  }
}

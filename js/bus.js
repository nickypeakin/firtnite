import * as THREE from 'three';
import { BUS } from './config.js';
import { createBusModel } from './models.js';

export class BattleBus {
  constructor(game, rng) {
    this.game = game;
    const a = rng.float(0, Math.PI * 2);
    const off = rng.float(-60, 60);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(off);
    this.start = dir.clone().multiplyScalar(-BUS.halfLength).add(side).setY(BUS.altitude);
    this.end = dir.clone().multiplyScalar(BUS.halfLength).add(side).setY(BUS.altitude);
    this.dir = dir;
    this.duration = (BUS.halfLength * 2) / BUS.speed;
    this.t = 0;
    this.position = this.start.clone();
    this.mesh = createBusModel();
    this.mesh.scale.setScalar(1.6);
    this.mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
    game.scene.add(this.mesh);
    this.done = false;
  }

  get progress() {
    return Math.min(1, this.t / this.duration);
  }

  update(dt) {
    this.t += dt;
    const k = this.t / this.duration;
    this.position.lerpVectors(this.start, this.end, k);
    this.position.y = BUS.altitude + Math.sin(this.t * 1.3) * 0.6;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.z = Math.sin(this.t * 0.9) * 0.03;
    if (!this.done && k >= 1) {
      this.done = true;
      this.game.onBusFinished();
    }
    if (k > 1.6) this.mesh.visible = false;
  }
}

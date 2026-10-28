import * as THREE from 'three';
import { PHYS, WEAPONS, CONSUMABLES, MAX_MATS } from './config.js';
import { createCharacterModel, createWeaponModel, createConsumableModel } from './models.js';
import { damp, dampAngle } from './util.js';

let nextId = 1;

export class Character {
  constructor(game, { name, skin, isPlayer = false }) {
    this.game = game;
    this.id = nextId++;
    this.name = name;
    this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = PHYS.radius;
    this.height = PHYS.height;
    this.health = 100;
    this.shield = 0;
    this.alive = true;
    this.hittable = false;
    this.state = 'bus';
    this.grounded = false;
    this.noGravity = false;
    this.slots = [{ kind: 'pickaxe', id: 'pickaxe' }, null, null, null, null, null];
    this.selected = 0;
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
    this.mats = { wood: 0, stone: 0, metal: 0 };
    this.kills = 0;
    this.fireCd = 0;
    this.reloadT = 0;
    this.bloom = 0;
    this.ads = false;
    this.swingT = 0;
    this.using = null;
    this.move = { x: 0, z: 0 };
    this.sprint = false;
    this.wantJump = false;
    this.lastHitBy = null;
    this.lastHitT = -99;
    this.visualY = 0;
    this.walkPhase = 0;
    this.modelYaw = 0;
    this.stepT = 0;
    this.model = createCharacterModel(skin);
    this.model.root.visible = false;
    game.scene.add(this.model.root);
    this.heldKey = '';
    this.held = null;
    this.onLand = (speed) => this.handleLand(speed);
  }

  get item() {
    return this.slots[this.selected];
  }

  get def() {
    const it = this.item;
    if (!it) return null;
    if (it.kind === 'weapon') return WEAPONS[it.id];
    if (it.kind === 'pickaxe') return WEAPONS.pickaxe;
    return null;
  }

  get eyeY() {
    return this.pos.y + PHYS.eye;
  }

  get totalHp() {
    return this.health + this.shield;
  }

  selectSlot(i) {
    if (i === this.selected || i < 0 || i > 5) return false;
    if (!this.slots[i]) return false;
    this.selected = i;
    this.reloadT = 0;
    this.using = null;
    this.swingT = 0;
    this.fireCd = Math.max(this.fireCd, 0.25);
    return true;
  }

  freeSlot() {
    for (let i = 1; i < 6; i++) if (!this.slots[i]) return i;
    return -1;
  }

  countWeapons() {
    let n = 0;
    for (let i = 1; i < 6; i++) if (this.slots[i] && this.slots[i].kind === 'weapon') n++;
    return n;
  }

  // Returns true when the whole item was taken.
  addItem(item) {
    if (item.kind === 'ammo') {
      this.ammo[item.id] = Math.min(999, this.ammo[item.id] + item.count);
      return true;
    }
    if (item.kind === 'mats') {
      this.mats[item.id] = Math.min(MAX_MATS, this.mats[item.id] + item.count);
      return true;
    }
    if (item.kind === 'consumable') {
      const max = CONSUMABLES[item.id].stack;
      for (let i = 1; i < 6; i++) {
        const s = this.slots[i];
        if (s && s.kind === 'consumable' && s.id === item.id && s.count < max) {
          const take = Math.min(max - s.count, item.count);
          s.count += take;
          item.count -= take;
          if (item.count <= 0) return true;
        }
      }
      const f = this.freeSlot();
      if (f < 0) return false;
      this.slots[f] = { ...item };
      item.count = 0;
      return true;
    }
    if (item.kind === 'weapon') {
      const f = this.freeSlot();
      if (f < 0) return false;
      this.slots[f] = { ...item };
      return true;
    }
    return false;
  }

  removeSlot(i) {
    const it = this.slots[i];
    this.slots[i] = null;
    if (this.selected === i) {
      this.selected = 0;
      for (let k = i; k < 6; k++) if (this.slots[k]) { this.selected = k; break; }
      if (!this.selected) for (let k = i - 1; k > 0; k--) if (this.slots[k]) { this.selected = k; break; }
      this.reloadT = 0;
      this.using = null;
    }
    return it;
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.visualY = y;
  }

  jumpFromBus(busPos) {
    this.state = 'freefall';
    this.hittable = true;
    this.setPosition(busPos.x, busPos.y - 3, busPos.z);
    this.vel.set(0, -5, 0);
    this.model.root.visible = true;
  }

  deployGlider() {
    if (this.state !== 'freefall') return;
    this.state = 'glide';
    this.model.glider.visible = true;
    this.game.audio.play('glider', this.pos, this.isPlayer ? 0.8 : 0.5);
  }

  land() {
    this.state = 'ground';
    this.noGravity = false;
    this.model.glider.visible = false;
  }

  handleLand(speed) {
    if (this.state !== 'ground') return;
    if (speed > 8) this.game.audio.play('land', this.pos, 0.6);
    if (speed > PHYS.fallDamageSpeed) {
      this.game.applyDamage(this, Math.round((speed - PHYS.fallDamageSpeed) * 7), null, { fall: true, ignoreShield: true, weapon: 'fall damage' });
    }
  }

  updateMovement(dt) {
    if (!this.alive || this.state === 'bus') return;
    const st = this.state;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = this.move.x, mz = this.move.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const v = this.vel;
    if (st === 'freefall') {
      this.noGravity = true;
      v.x = damp(v.x, wx * PHYS.freefallH, 2.5, dt);
      v.z = damp(v.z, wz * PHYS.freefallH, 2.5, dt);
      v.y = damp(v.y, -PHYS.freefallSpeed * (mz > 0.5 ? 1.25 : 1), 1.5, dt);
      const ground = this.game.collision.groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y - ground < PHYS.gliderDeployHeight) this.deployGlider();
    } else if (st === 'glide') {
      this.noGravity = true;
      v.x = damp(v.x, wx * PHYS.gliderH + fx * 3, 1.8, dt);
      v.z = damp(v.z, wz * PHYS.gliderH + fz * 3, 1.8, dt);
      v.y = damp(v.y, -PHYS.gliderSpeed * (mz > 0.5 ? 1.2 : 1), 3, dt);
    } else {
      this.noGravity = false;
      let speed = this.sprint && mz > 0.3 && !this.ads ? PHYS.sprintSpeed : PHYS.walkSpeed;
      if (this.ads) speed = PHYS.adsSpeed;
      if (this.using) speed = PHYS.useSpeed;
      if (this.pos.y < -0.3) speed *= 0.6;
      const accel = this.grounded ? 14 : 4;
      v.x = damp(v.x, wx * speed, accel, dt);
      v.z = damp(v.z, wz * speed, accel, dt);
      if (this.wantJump && this.grounded) {
        v.y = PHYS.jumpVel;
        this.grounded = false;
        this.game.audio.play('jump', this.pos, this.isPlayer ? 0.5 : 0.3);
      }
    }
    this.wantJump = false;
    this.game.collision.moveCharacter(this, dt);
    if ((st === 'glide' || st === 'freefall') && this.grounded) this.land();
  }

  getMuzzle(out) {
    const mz = this.held && this.held.userData.muzzle;
    if (mz && this.model.root.visible) return mz.getWorldPosition(out);
    return out.set(this.pos.x, this.eyeY - 0.25, this.pos.z);
  }

  syncHeld() {
    const it = this.item;
    const key = it ? `${it.kind}:${it.id}:${it.rarity || 0}` : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    const holder = this.model.weaponHolder;
    if (this.held) {
      holder.remove(this.held);
      this.held.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
    }
    this.held = null;
    if (!it) return;
    if (it.kind === 'weapon' || it.kind === 'pickaxe') this.held = createWeaponModel(it.id, it.rarity || 0);
    else if (it.kind === 'consumable') {
      this.held = createConsumableModel(it.id);
      this.held.position.set(-0.1, 0.05, -0.15);
    }
    if (this.held) holder.add(this.held);
  }

  updateVisual(dt, camPos) {
    const m = this.model;
    if (!this.alive || this.state === 'bus') {
      m.root.visible = false;
      return;
    }
    const d = camPos ? Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z) : 0;
    m.root.visible = d < 230 && !(this.isPlayer && this.game.player && this.game.player.hideSelf);
    if (Math.abs(this.visualY - this.pos.y) > 1.5) this.visualY = this.pos.y;
    else this.visualY = damp(this.visualY, this.pos.y, 22, dt);
    if (!m.root.visible) return;
    this.syncHeld();
    m.root.position.set(this.pos.x, this.visualY, this.pos.z);
    this.modelYaw = dampAngle(this.modelYaw, this.yaw, 16, dt);
    m.root.rotation.y = this.modelYaw;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const it = this.item;
    const pitch = this.pitch;

    if (this.state === 'freefall') {
      m.body.rotation.x = -1.25;
      m.body.position.set(0, 0.685, 0.949);
      m.legL.rotation.set(0.3, 0, -0.35);
      m.legR.rotation.set(0.3, 0, 0.35);
      m.armL.rotation.set(0, 0, -1.9);
      m.armR.rotation.set(0, 0, 1.9);
      m.weaponHolder.visible = false;
      return;
    }
    m.body.position.set(0, 0, 0);
    m.weaponHolder.visible = true;
    if (this.state === 'glide') {
      m.body.rotation.x = -0.12;
      m.legL.rotation.set(0.15, 0, 0);
      m.legR.rotation.set(-0.1, 0, 0);
      m.armL.rotation.set(0, 0, -2.7);
      m.armR.rotation.set(0, 0, 2.7);
      m.weaponHolder.visible = false;
      return;
    }
    m.body.rotation.x = 0;
    if (this.grounded) {
      this.walkPhase += hs * dt * 1.8;
      const k = Math.min(1, hs / 6);
      const sw = Math.sin(this.walkPhase) * 0.8 * k;
      m.legL.rotation.set(sw, 0, 0);
      m.legR.rotation.set(-sw, 0, 0);
      if (hs > 3 && d < 32) {
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = 0.32;
          this.game.audio.play('step', this.pos, this.isPlayer ? 0.25 : 0.55);
        }
      }
    } else {
      m.legL.rotation.set(-0.5, 0, 0);
      m.legR.rotation.set(0.3, 0, 0);
    }
    m.weaponHolder.rotation.x = pitch;
    if (it && it.kind === 'weapon') {
      const aim = Math.PI / 2 + pitch;
      const kick = Math.max(0, this.fireCd - (1 / WEAPONS[it.id].rate) + 0.08) * 3;
      m.armR.rotation.set(aim + kick, 0, 0.1);
      m.armL.rotation.set(aim + kick, 0, -0.55);
      m.weaponHolder.position.set(0.22, 1.33, -0.32 + kick * 0.15);
      if (this.reloadT > 0) m.weaponHolder.rotation.x = pitch - 0.6;
    } else if (it && it.kind === 'pickaxe') {
      m.weaponHolder.position.set(0.34, 1.12, -0.32);
      let a = 0.45;
      if (this.swingT > 0) {
        const p = 1 - this.swingT / 0.35;
        a = p < 0.4 ? 0.45 + p * 5 : 2.45 - (p - 0.4) * 5.5;
      }
      m.armR.rotation.set(a + pitch * 0.5, 0, 0.1);
      m.armL.rotation.set(Math.sin(this.walkPhase) * -0.6 * Math.min(1, hs / 6), 0, -0.1);
      m.weaponHolder.rotation.x = a - 1.1 + pitch * 0.5;
    } else {
      m.weaponHolder.position.set(0.15, 1.15, -0.35);
      m.armR.rotation.set(1.0, 0, 0.2);
      m.armL.rotation.set(1.0, 0, -0.3);
    }
  }

  dispose() {
    this.game.scene.remove(this.model.root);
  }
}

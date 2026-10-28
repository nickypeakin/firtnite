import * as THREE from 'three';
import { WEAPONS, CONSUMABLES } from './config.js';
import { lerp, smoothstep } from './util.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _m = new THREE.Vector3();
const _end = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Random direction inside a cone of half-angle `spread` around dir (in place).
function applySpread(dir, spread) {
  if (spread <= 0) return dir;
  _r.crossVectors(dir, UP);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, dir).normalize();
  const a = Math.random() * Math.PI * 2;
  const s = Math.tan(spread) * Math.sqrt(Math.random());
  dir.addScaledVector(_r, Math.cos(a) * s).addScaledVector(_u, Math.sin(a) * s).normalize();
  return dir;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.rockets = [];
    this.rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2);
    this.rocketMat = new THREE.MeshLambertMaterial({ color: 0x556b3a, emissive: 0x331100 });
  }

  currentSpread(ch, def) {
    let s = ch.ads ? def.adsSpread : def.spread;
    const hs = Math.hypot(ch.vel.x, ch.vel.z);
    if (!ch.grounded) s *= 1.8;
    else if (hs > 1.5) s *= 1.35;
    return s + ch.bloom;
  }

  update(ch, dt) {
    if (ch.fireCd > 0) ch.fireCd -= dt;
    if (ch.swingT > 0) ch.swingT -= dt;
    const it = ch.item;
    const def = ch.def;
    if (def && def.maxBloom) ch.bloom = Math.max(0, ch.bloom - dt * def.maxBloom * 2.5);
    else ch.bloom = 0;
    if (ch.reloadT > 0) {
      ch.reloadT -= dt;
      if (ch.reloadT <= 0 && it && it.kind === 'weapon') {
        const need = def.mag - it.mag;
        const take = Math.min(need, ch.ammo[def.ammo]);
        it.mag += take;
        ch.ammo[def.ammo] -= take;
        ch.reloadT = 0;
      }
    }
    if (ch.using) {
      if (!it || it.kind !== 'consumable' || it.id !== ch.using.id) {
        ch.using = null;
      } else {
        ch.using.t += dt;
        if (ch.using.t >= ch.using.dur) this.finishUse(ch);
      }
    }
  }

  canReload(ch) {
    const it = ch.item;
    if (!it || it.kind !== 'weapon' || ch.reloadT > 0) return false;
    const def = WEAPONS[it.id];
    return it.mag < def.mag && ch.ammo[def.ammo] > 0;
  }

  reload(ch) {
    if (!this.canReload(ch)) return false;
    const it = ch.item;
    ch.reloadT = WEAPONS[it.id].reload[it.rarity];
    ch.ads = false;
    if (ch.isPlayer) this.game.audio.play('reload');
    return true;
  }

  canUse(ch, id) {
    const c = CONSUMABLES[id];
    if (c.heal) return ch.health < c.cap;
    return ch.shield < c.cap;
  }

  startUse(ch) {
    const it = ch.item;
    if (!it || it.kind !== 'consumable' || ch.using) return false;
    if (!this.canUse(ch, it.id)) {
      if (ch.isPlayer) this.game.hud.toast(CONSUMABLES[it.id].heal ? 'Health is full' : 'Shield is full');
      return false;
    }
    ch.using = { id: it.id, t: 0, dur: CONSUMABLES[it.id].time };
    if (ch.isPlayer) this.game.audio.play('heal');
    return true;
  }

  finishUse(ch) {
    const it = ch.item;
    const c = CONSUMABLES[it.id];
    if (c.heal) ch.health = Math.min(c.cap, Math.max(ch.health, ch.health + c.heal));
    if (c.shield) ch.shield = Math.min(c.cap, Math.max(ch.shield, ch.shield + c.shield));
    ch.using = null;
    it.count--;
    if (it.count <= 0) ch.removeSlot(ch.selected);
    if (ch.isPlayer) this.game.audio.play('pickup');
  }

  // Main attack. origin/dir is the aim ray (eye position + look direction).
  tryAttack(ch, origin, dir) {
    const it = ch.item;
    if (!it || ch.fireCd > 0) return false;
    if (it.kind === 'pickaxe') return this.melee(ch, origin, dir);
    if (it.kind === 'consumable') return this.startUse(ch);
    if (it.kind !== 'weapon' || ch.reloadT > 0) return false;
    const def = WEAPONS[it.id];
    if (it.mag <= 0) {
      if (!this.reload(ch) && ch.isPlayer) {
        this.game.audio.play('click');
        ch.fireCd = 0.25;
      }
      return false;
    }
    ch.using = null;
    it.mag--;
    ch.fireCd = 1 / def.rate;
    const muzzle = ch.getMuzzle(_m);
    if (def.projectile) {
      this.spawnRocket(ch, origin, dir, def, it.rarity);
    } else {
      const pellets = def.pellets || 1;
      const spread = this.currentSpread(ch, def) + (ch.botSpread || 0);
      const perPellet = def.dmg[it.rarity];
      let hitAny = false;
      for (let p = 0; p < pellets; p++) {
        _d.copy(dir);
        // First shot while aiming and standing still is perfectly accurate (rifles/pistols).
        const first = pellets === 1 && ch.ads && ch.bloom < 1e-4 && ch.grounded && Math.hypot(ch.vel.x, ch.vel.z) < 0.5;
        applySpread(_d, first ? 0 : spread);
        const hit = this.hitscan(ch, origin, _d, def.range);
        const showTracer = pellets === 1 || p % 3 === 0;
        if (hit) {
          const dist = hit.t;
          let mult = 1;
          if (def.falloffStart && dist > def.falloffStart) mult = lerp(1, def.falloffMin, smoothstep(def.falloffStart, def.falloffEnd, dist));
          this.applyHit(ch, hit, perPellet * mult, def, pellets > 1);
          hitAny = true;
          if (showTracer) this.game.effects.tracer(muzzle, _end.set(hit.x, hit.y, hit.z), ch.isPlayer ? 0xffe08a : 0xffb070);
        } else if (showTracer) {
          this.game.effects.tracer(muzzle, _end.copy(origin).addScaledVector(_d, Math.min(def.range, 160)), ch.isPlayer ? 0xffe08a : 0xffb070);
        }
      }
      if (pellets > 1 && hitAny) this.flushPellets(ch);
      ch.bloom = Math.min(def.maxBloom || 0, ch.bloom + (def.bloom || 0));
    }
    this.game.effects.flash(muzzle, 0xffd27a, def.type === 'shotgun' ? 1.1 : 0.7, 0.05);
    this.game.audio.play(def.sound, ch.isPlayer ? null : ch.pos, ch.isPlayer ? 0.75 : 1);
    if (ch.isPlayer) this.game.player.recoil(def);
    if (it.mag <= 0 && ch.ammo[def.ammo] > 0) this.reload(ch);
    this.game.noise(ch, def.type === 'sniper' ? 200 : 120);
    return true;
  }

  hitscan(ch, origin, dir, range) {
    return this.game.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, {
      characters: this.game.characters,
      ignoreChar: ch,
    });
  }

  // Shotgun pellets are summed per target so the damage number reads as one hit.
  flushPellets(ch) {
    if (!this._pellets) return;
    for (const [target, acc] of this._pellets) {
      this.game.applyDamage(target, acc.dmg, ch, { headshot: acc.head, weapon: acc.weapon, point: acc.point });
    }
    this._pellets.clear();
  }

  applyHit(ch, hit, dmg, def, pellet = false) {
    const g = this.game;
    if (hit.character) {
      const target = hit.character;
      const d = dmg * (hit.head ? def.headMult : 1);
      if (pellet) {
        if (!this._pellets) this._pellets = new Map();
        let acc = this._pellets.get(target);
        if (!acc) this._pellets.set(target, (acc = { dmg: 0, head: false, weapon: def.name, point: new THREE.Vector3(hit.x, hit.y, hit.z) }));
        acc.dmg += d;
        acc.head = acc.head || hit.head;
      } else {
        g.applyDamage(target, d, ch, { headshot: hit.head, weapon: def.name, point: new THREE.Vector3(hit.x, hit.y, hit.z) });
      }
      g.effects.burst(_end.set(hit.x, hit.y, hit.z), target.shield > 0 ? 0x5ec8ff : 0xff5050, 3, 3, 0.07, 1, 0.3);
      return;
    }
    const pos = _end.set(hit.x, hit.y, hit.z);
    if (hit.collider) {
      const owner = hit.collider.owner;
      if (owner && owner.isPiece) {
        this.damageStructure(ch, owner, dmg, pos);
        g.effects.impact(pos, owner.material === 'wood' ? 0xb07a45 : 0xbbbbbb);
      } else if (owner && owner.isProp) {
        g.world.damageProp(owner, dmg);
        g.effects.impact(pos, owner.kind === 'tree' ? 0x8a5a32 : 0xaaaaaa);
      }
    } else {
      g.effects.impact(pos, 0x9a8a6a);
    }
  }

  damageStructure(ch, piece, dmg, pos) {
    if (!piece.alive) return;
    this.game.structures.damage(piece, dmg);
    if (ch && ch.isPlayer) {
      this.game.hud.damageNumber(pos, dmg, 'build');
      this.game.hud.showTargetHp(piece);
    }
  }

  melee(ch, origin, dir) {
    const def = WEAPONS.pickaxe;
    ch.fireCd = 1 / def.rate;
    ch.swingT = 0.35;
    const g = this.game;
    const hit = g.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range + (ch.isPlayer ? 0.6 : 0), {
      characters: g.characters,
      ignoreChar: ch,
    });
    if (!hit) {
      g.audio.play('pickaxe', ch.isPlayer ? null : ch.pos, 0.5);
      return true;
    }
    const pos = new THREE.Vector3(hit.x, hit.y, hit.z);
    if (hit.character) {
      g.applyDamage(hit.character, def.dmg, ch, { weapon: def.name, point: pos });
      g.audio.play('harvest_wood', ch.isPlayer ? null : ch.pos, 0.6);
      return true;
    }
    const owner = hit.collider && hit.collider.owner;
    if (owner && owner.isProp) {
      g.world.damageProp(owner, def.structDmg);
      const mat = owner.mat;
      const amount = owner.kind === 'tree' ? 12 : owner.kind === 'rock' ? 10 : 9;
      ch.addItem({ kind: 'mats', id: mat, count: amount });
      g.audio.play(`harvest_${mat}`, ch.isPlayer ? null : ch.pos, 0.8);
      g.effects.burst(pos, owner.kind === 'tree' ? 0x8a5a32 : owner.kind === 'rock' ? 0x9b968f : 0x9aa6b2, 6, 3, 0.12, 1, 0.5);
      if (ch.isPlayer) g.hud.harvested(mat, amount);
    } else if (owner && owner.isPiece) {
      this.damageStructure(ch, owner, def.structDmg, pos);
      if (owner.map) {
        const amount = 5;
        ch.addItem({ kind: 'mats', id: owner.material, count: amount });
        if (ch.isPlayer) g.hud.harvested(owner.material, amount);
      }
      g.audio.play(`harvest_${owner.material}`, ch.isPlayer ? null : ch.pos, 0.8);
      g.effects.burst(pos, 0xb07a45, 5, 3, 0.1, 1, 0.5);
    } else {
      g.audio.play('pickaxe', ch.isPlayer ? null : ch.pos, 0.6);
      g.effects.impact(pos, 0x9a8a6a);
    }
    return true;
  }

  spawnRocket(ch, origin, dir, def, rarity) {
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    const start = ch.getMuzzle(new THREE.Vector3());
    // Aim the rocket from the muzzle toward the point the aim ray targets.
    const aimHit = this.game.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range, { characters: this.game.characters, ignoreChar: ch });
    const target = aimHit ? new THREE.Vector3(aimHit.x, aimHit.y, aimHit.z) : origin.clone().addScaledVector(dir, def.range);
    const vdir = target.sub(start).normalize();
    applySpread(vdir, ch.ads ? def.adsSpread : def.spread);
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(vdir));
    this.game.scene.add(mesh);
    this.rockets.push({ mesh, pos: start, vel: vdir.multiplyScalar(def.speed), owner: ch, def, rarity, life: 6, trailT: 0 });
  }

  updateProjectiles(dt) {
    const g = this.game;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      const hit = g.collision.raycast(r.pos.x, r.pos.y, r.pos.z, _d.x, _d.y, _d.z, step, { characters: g.characters, ignoreChar: r.owner });
      if (hit || r.life <= 0) {
        const p = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : r.pos.clone();
        this.explode(p, r.def, r.rarity, r.owner, hit);
        g.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.02;
        g.effects.particle(r.pos.x, r.pos.y, r.pos.z, (Math.random() - 0.5), (Math.random() - 0.5) + 0.5, (Math.random() - 0.5), 0xcccccc, 0.25, 0.6, -0.05);
      }
    }
  }

  explode(pos, def, rarity, owner, directHit) {
    const g = this.game;
    const R = def.splash;
    g.effects.explosion(pos, R);
    g.audio.play('explosion', pos, 1);
    const dmg = def.dmg[rarity];
    for (const ch of g.characters) {
      if (!ch.alive || !ch.hittable) continue;
      const d = Math.hypot(ch.pos.x - pos.x, ch.pos.y + 0.9 - pos.y, ch.pos.z - pos.z);
      if (d > R) continue;
      const k = directHit && directHit.character === ch ? 1 : 1 - (d / R) * 0.6;
      g.applyDamage(ch, Math.round(dmg * k), owner, { weapon: def.name, point: ch.pos.clone().setY(ch.pos.y + 1), explosive: true });
    }
    const cols = g.collision.queryBox(pos.x - R, pos.y - R, pos.z - R, pos.x + R, pos.y + R, pos.z + R, []);
    const seen = new Set();
    for (const c of cols) {
      const o = c.owner;
      if (!o || seen.has(o)) continue;
      seen.add(o);
      if (o.isPiece) this.damageStructure(owner, o, def.structDmg, pos);
      else if (o.isProp) g.world.damageProp(o, def.structDmg * 0.5);
    }
    const pd = g.player && g.player.ch.pos.distanceTo(pos);
    if (pd !== undefined && pd < 40) g.player.addShake(Math.max(0, 1 - pd / 40) * 0.8);
  }
}

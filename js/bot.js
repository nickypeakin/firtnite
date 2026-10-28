import * as THREE from 'three';
import { WEAPONS, CONSUMABLES, AMMO, BUILD_COST } from './config.js';
import { damp, dampAngle, lerp, wrapAngle, yawTo } from './util.js';
import { computeBuildTarget } from './structures.js';

const PREF_DIST = { shotgun: 5, smg: 11, pistol: 16, ar: 26, sniper: 70, rocket: 28 };
export const DIFFICULTY = { easy: [0.12, 0.45], normal: [0.3, 0.78], hard: [0.6, 1.0] };
// Bot damage scale per difficulty keeps fights survivable for the player.
const DAMAGE = { easy: 0.5, normal: 0.65, hard: 0.9 };

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

function weaponScore(id, rarity, d) {
  let p;
  switch (id) {
    case 'shotgun': p = d < 9 ? 10 : d < 18 ? 4 : 0.5; break;
    case 'smg': p = d < 14 ? 8 : d < 35 ? 6 : 2; break;
    case 'pistol': p = d < 30 ? 4 : 2; break;
    case 'ar': p = d < 7 ? 5 : d < 90 ? 9 : 6; break;
    case 'sniper': p = d > 55 ? 11 : d > 25 ? 6 : 1; break;
    case 'rocket': p = d > 9 && d < 70 ? 7 : 0.3; break;
    default: p = 1;
  }
  return p + rarity * 0.6;
}

export class Bot {
  constructor(game, ch, rng, difficulty = 'normal') {
    this.game = game;
    this.ch = ch;
    this.rng = rng;
    const [lo, hi] = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.skill = rng.float(lo, hi);
    ch.botSpread = (1 - this.skill) * 0.04 + 0.006;
    ch.dmgMult = DAMAGE[difficulty] || DAMAGE.normal;
    this.burstT = 0;
    this.pauseT = 0;
    this.landT = 0;
    this.jumpAt = 0;
    this.dropTarget = { x: 0, z: 0 };
    this.mode = 'roam';
    this.target = null;
    this.targetVisible = false;
    this.blockedByPiece = false;
    this.lastSeen = new THREE.Vector3();
    this.lastSeenT = -99;
    this.reactT = 0;
    this.goal = null;
    this.thinkT = rng.float(0, 0.3);
    this.strafeDir = rng.chance(0.5) ? 1 : -1;
    this.strafeT = 0;
    this.stuckT = 0;
    this.checkT = 0.5;
    this.lastPos = new THREE.Vector3();
    this.detourT = 0;
    this.detourYaw = 0;
    this.aimErrYaw = 0;
    this.aimErrPitch = 0;
    this.aimErrT = 0;
    this.buildCd = rng.float(1, 3);
    this.weaponT = 0;
    this.loot = null;
    this.lootBestD = Infinity;
    this.lootProgressT = 0;
    this.ignore = new Set();
    this.heard = null;
    this.breakTarget = null;
    this.breakT = 0;
    this.landed = false;
  }

  update(dt) {
    const ch = this.ch, g = this.game;
    if (!ch.alive) return;
    if (ch.state === 'bus') {
      if (g.bus.t >= this.jumpAt) g.jumpFromBus(ch);
      return;
    }
    if (ch.state === 'freefall' || ch.state === 'glide') {
      const dx = this.dropTarget.x - ch.pos.x, dz = this.dropTarget.z - ch.pos.z;
      ch.yaw = dampAngle(ch.yaw, yawTo(dx, dz), 3, dt);
      ch.move.x = 0;
      ch.move.z = Math.hypot(dx, dz) > 5 ? 1 : 0;
      return;
    }
    if (!this.landed) {
      this.landed = true;
      this.landT = g.time;
      ch.mats.wood = this.rng.int(30, 160);
      ch.mats.stone = this.rng.int(0, 60);
    }
    this.buildCd -= dt;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.22 + this.rng.next() * 0.16;
      this.think();
    }
    ch.ads = false;
    ch.sprint = false;
    if (this.mode === 'fight') {
      this.breakT = 0;
      this.actFight(dt);
    } else if (this.breakT > 0) this.actBreak(dt);
    else if (this.mode === 'heal') this.actHeal(dt);
    else this.actTravel(dt);
    this.handleStuck(dt);
  }

  // World-space wish direction to local move intent.
  moveWorld(dx, dz, scale = 1) {
    const ch = this.ch;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) { ch.move.x = 0; ch.move.z = 0; return; }
    dx /= l; dz /= l;
    const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
    const rx = Math.cos(ch.yaw), rz = -Math.sin(ch.yaw);
    ch.move.x = (dx * rx + dz * rz) * scale;
    ch.move.z = (dx * fx + dz * fz) * scale;
  }

  findEnemy() {
    const g = this.game, ch = this.ch;
    const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
    const cands = [];
    for (const o of g.characters) {
      if (o === ch || !o.alive || !o.hittable) continue;
      const dx = o.pos.x - ch.pos.x, dz = o.pos.z - ch.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > (o === this.target ? 95 : 70)) continue;
      if (d > 20 && (dx * fx + dz * fz) / d < 0.35 && o !== this.target) continue;
      cands.push([o === this.target ? d * 0.6 : d, o]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const ey = ch.eyeY;
    for (let i = 0; i < Math.min(3, cands.length); i++) {
      const o = cands[i][1];
      if (g.collision.lineOfSight(ch.pos.x, ey, ch.pos.z, o.pos.x, o.pos.y + 1.3, o.pos.z)) return o;
    }
    return null;
  }

  bestWeapon(d) {
    const ch = this.ch;
    let best = -1, bestS = 0;
    for (let i = 1; i < 6; i++) {
      const it = ch.slots[i];
      if (!it || it.kind !== 'weapon') continue;
      const def = WEAPONS[it.id];
      if (it.mag <= 0 && ch.ammo[def.ammo] <= 0) continue;
      const s = weaponScore(it.id, it.rarity, d);
      if (s > bestS) { bestS = s; best = i; }
    }
    return best;
  }

  healSlot() {
    const ch = this.ch, g = this.game;
    let best = -1;
    for (let i = 1; i < 6; i++) {
      const it = ch.slots[i];
      if (!it || it.kind !== 'consumable' || !g.combat.canUse(ch, it.id)) continue;
      const c = CONSUMABLES[it.id];
      // Shields first when health is fine.
      if (c.shield && ch.health >= 70) return i;
      if (c.heal && ch.health < 70) return i;
      if (best < 0) best = i;
    }
    return best;
  }

  wantsItem(item) {
    const ch = this.ch;
    if (item.kind === 'ammo' || item.kind === 'mats') return true;
    if (item.kind === 'consumable') {
      let slots = 0;
      for (let i = 1; i < 6; i++) {
        const s = ch.slots[i];
        if (s && s.kind === 'consumable') {
          if (s.id === item.id && s.count < CONSUMABLES[s.id].stack) return true;
          slots++;
        }
      }
      return slots < 2 && ch.freeSlot() > 0;
    }
    if (item.kind === 'weapon') {
      for (let i = 1; i < 6; i++) {
        const s = ch.slots[i];
        if (s && s.kind === 'weapon' && s.id === item.id) return item.rarity > s.rarity;
      }
      return ch.countWeapons() < 3 && ch.freeSlot() > 0;
    }
    return false;
  }

  // Slot to replace when picking up a weapon upgrade of a type already held.
  swapSlotFor(item) {
    const ch = this.ch;
    for (let i = 1; i < 6; i++) {
      const s = ch.slots[i];
      if (s && s.kind === 'weapon' && s.id === item.id) return i;
    }
    return -1;
  }

  pickLootTarget() {
    const g = this.game, ch = this.ch;
    let best = null, bestD = ch.countWeapons() === 0 ? 110 : 75;
    const claimed = (o) => o.claim && o.claim !== this && o.claim.ch.alive && g.time - o.claimT < 12;
    for (const c of g.items.chests) {
      if (c.opened || this.ignore.has(c) || claimed(c)) continue;
      const d = c.pos.distanceTo(ch.pos) + Math.abs(c.pos.y - ch.pos.y) * 2;
      if (d < bestD) { bestD = d; best = { type: 'chest', obj: c }; }
    }
    for (const p of g.items.pickups) {
      if (!p.alive || !p.settled || this.ignore.has(p) || p.item.kind === 'ammo' || p.item.kind === 'mats' || claimed(p)) continue;
      if (!this.wantsItem(p.item)) continue;
      const d = p.pos.distanceTo(ch.pos) * 0.8 + Math.abs(p.pos.y - ch.pos.y) * 2;
      if (d < bestD) { bestD = d; best = { type: 'pickup', obj: p }; }
    }
    this.loot = best;
    if (best) {
      best.obj.claim = this;
      best.obj.claimT = g.time;
    }
    this.lootBestD = Infinity;
    this.lootProgressT = g.time;
    return best;
  }

  needsLoot() {
    const ch = this.ch;
    let heals = 0;
    for (let i = 1; i < 6; i++) if (ch.slots[i] && ch.slots[i].kind === 'consumable') heals++;
    return ch.countWeapons() < 2 || heals === 0 || this.rng.chance(0.15);
  }

  think() {
    const g = this.game, ch = this.ch, now = g.time;
    const seen = this.findEnemy();
    if (seen) {
      if (seen !== this.target) {
        this.target = seen;
        this.reactT = now + lerp(0.75, 0.15, this.skill);
      }
      this.targetVisible = true;
      this.lastSeen.copy(seen.pos);
      this.lastSeenT = now;
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || now - this.lastSeenT > 5)) this.target = null;
    }
    const atk = ch.lastHitBy;
    if (atk && atk.alive && atk !== ch && now - ch.lastHitT < 1.5 && (!this.target || !this.targetVisible)) {
      this.target = atk;
      this.lastSeen.copy(atk.pos);
      this.lastSeenT = now;
      this.reactT = Math.min(this.reactT, now + 0.35);
    }
    this.blockedByPiece = false;
    if (this.target && !this.targetVisible) {
      const t = this.target;
      const dx = t.pos.x - ch.pos.x, dy = t.pos.y + 1.2 - ch.eyeY, dz = t.pos.z - ch.pos.z;
      const d = Math.hypot(dx, dy, dz);
      const hit = g.collision.raycast(ch.pos.x, ch.eyeY, ch.pos.z, dx / d, dy / d, dz / d, d);
      this.blockedByPiece = !!(hit && hit.collider && hit.collider.owner && hit.collider.owner.isPiece && hit.t < 40);
    }

    if (this.loot) {
      const o = this.loot.obj;
      const gone = this.loot.type === 'chest' ? o.opened : !o.alive || !this.wantsItem(o.item);
      if (gone) this.loot = null;
      else {
        const d = o.pos.distanceTo(ch.pos);
        if (d < this.lootBestD - 1) { this.lootBestD = d; this.lootProgressT = now; }
        else if (now - this.lootProgressT > 5) { this.ignore.add(o); this.loot = null; }
      }
    }

    const storm = g.storm;
    const distNext = Math.hypot(ch.pos.x - storm.next.x, ch.pos.z - storm.next.z) - storm.next.r;
    const outsideNow = storm.isOutside(ch.pos.x, ch.pos.z);
    const mustRotate = distNext > -6 && (storm.state === 'shrink' || storm.timer < 12 + distNext / 6);
    const armed = this.bestWeapon(20) > 0;
    const tDist = this.target ? this.target.pos.distanceTo(ch.pos) : Infinity;
    const prev = this.mode;
    // Without a gun, only swing back at someone who is right on top of us.
    const melee = !armed && tDist < 4 && atk === this.target && now - ch.lastHitT < 2;
    // Freshly landed bots focus on looting unless someone is close or shooting them.
    const keen = now - this.landT > 45 || tDist < 12 || now - ch.lastHitT < 3;
    if (this.target && keen && (this.targetVisible || now - this.lastSeenT < 3) && (armed || melee) && !(outsideNow && tDist > 40)) {
      this.mode = 'fight';
    } else if (outsideNow || mustRotate) {
      this.mode = 'storm';
    } else if ((ch.health < 75 || ch.shield < 50) && this.healSlot() > 0 && now - ch.lastHitT > 2.5) {
      this.mode = 'heal';
    } else if ((this.loot || (this.needsLoot() && this.pickLootTarget())) && this.loot) {
      this.mode = 'loot';
    } else if (this.heard && now - this.heard.t < 8 && armed && this.skill > 0.35) {
      this.mode = 'investigate';
    } else {
      this.mode = 'roam';
    }
    if (prev !== this.mode) this.goal = null;

    if (this.mode === 'storm' && !this.goal) {
      const a = this.rng.float(0, Math.PI * 2), r = this.rng.float(0, storm.next.r * 0.5);
      this.goal = { x: storm.next.x + Math.cos(a) * r, z: storm.next.z + Math.sin(a) * r, r: 5 };
    } else if (this.mode === 'loot') {
      this.goal = { x: this.loot.obj.pos.x, z: this.loot.obj.pos.z, r: 1.2 };
    } else if (this.mode === 'investigate') {
      this.goal = { x: this.heard.x, z: this.heard.z, r: 8 };
    } else if (this.mode === 'roam' && !this.goal) {
      for (let i = 0; i < 12; i++) {
        const a = this.rng.float(0, Math.PI * 2), r = this.rng.float(25, 70);
        const x = ch.pos.x + Math.cos(a) * r, z = ch.pos.z + Math.sin(a) * r;
        if (!storm.insideNext(x, z, 10) || g.terrain.height(x, z) < 0.5) continue;
        this.goal = { x, z, r: 4 };
        break;
      }
      if (!this.goal) this.goal = { x: storm.next.x, z: storm.next.z, r: 6 };
    }
  }

  actTravel(dt) {
    const ch = this.ch, g = this.game;
    if (!this.goal) {
      ch.move.x = ch.move.z = 0;
      return;
    }
    const dx = this.goal.x - ch.pos.x, dz = this.goal.z - ch.pos.z;
    const d = Math.hypot(dx, dz);
    if (this.mode === 'loot' && this.loot) {
      const o = this.loot.obj;
      const dy = Math.abs(o.pos.y - ch.pos.y);
      if (d < (this.loot.type === 'chest' ? 2.2 : 1.8) && dy < 2) {
        if (this.loot.type === 'chest') g.items.openChest(o, ch);
        else {
          const item = o.item;
          const swap = item.kind === 'weapon' && ch.freeSlot() < 0 ? this.swapSlotFor(item) : -1;
          if (item.kind === 'weapon' && ch.freeSlot() < 0 && swap < 0) this.ignore.add(o);
          else if (g.items.pickup(ch, o, swap) && item.kind === 'weapon') {
            const a = WEAPONS[item.id].ammo;
            ch.ammo[a] += AMMO[a].give * 2;
          } else this.ignore.add(o);
        }
        this.loot = null;
        this.goal = null;
        this.thinkT = 0.05;
        return;
      }
    } else if (d < this.goal.r) {
      this.goal = null;
      if (this.mode === 'investigate') this.heard = null;
      ch.move.x = ch.move.z = 0;
      return;
    }
    let yaw = yawTo(dx, dz);
    if (this.detourT > 0) {
      this.detourT -= dt;
      yaw = this.detourYaw;
    }
    ch.yaw = dampAngle(ch.yaw, yaw, 6, dt);
    ch.pitch = damp(ch.pitch, 0, 4, dt);
    ch.move.x = 0;
    ch.move.z = 1;
    ch.sprint = d > 10;
    // Keep a weapon out while moving around.
    if (ch.selected === 0 || (ch.item && ch.item.kind === 'consumable')) {
      const w = this.bestWeapon(25);
      if (w > 0) ch.selectSlot(w);
    }
    if (this.game.storm.isOutside(ch.pos.x, ch.pos.z) && this.rng.chance(dt * 0.3)) ch.wantJump = true;
  }

  actHeal(dt) {
    const ch = this.ch, g = this.game;
    ch.move.x = ch.move.z = 0;
    if (ch.using) return;
    const slot = this.healSlot();
    if (slot < 0) {
      this.mode = 'roam';
      return;
    }
    if (ch.selected !== slot) ch.selectSlot(slot);
    else g.combat.tryAttack(ch, _o, _d);
  }

  actBreak(dt) {
    const ch = this.ch, g = this.game, t = this.breakTarget;
    this.breakT -= dt;
    if (!t || !t.alive) {
      this.breakT = 0;
      return;
    }
    if (ch.selected !== 0) ch.selectSlot(0);
    let cx, cy, cz;
    if (t.isPiece) {
      const b = t.bounds;
      cx = (b.minX + b.maxX) / 2; cy = Math.min(b.maxY - 0.3, ch.eyeY); cz = (b.minZ + b.maxZ) / 2;
    } else {
      cx = t.x; cy = ch.eyeY - 0.4; cz = t.z;
    }
    const dx = cx - ch.pos.x, dz = cz - ch.pos.z;
    ch.yaw = dampAngle(ch.yaw, yawTo(dx, dz), 10, dt);
    ch.move.x = 0;
    ch.move.z = Math.hypot(dx, dz) > 1.6 ? 0.5 : 0;
    _o.set(ch.pos.x, ch.eyeY, ch.pos.z);
    _d.set(dx, cy - ch.eyeY, dz).normalize();
    g.combat.tryAttack(ch, _o, _d);
  }

  actFight(dt) {
    const ch = this.ch, g = this.game, now = g.time;
    const t = this.target;
    if (!t || !t.alive) {
      this.target = null;
      this.mode = 'roam';
      return;
    }
    const tx = this.targetVisible ? t.pos.x : this.lastSeen.x;
    const ty = this.targetVisible ? t.pos.y : this.lastSeen.y;
    const tz = this.targetVisible ? t.pos.z : this.lastSeen.z;
    const dx = tx - ch.pos.x, dz = tz - ch.pos.z;
    const d = Math.max(0.5, Math.hypot(dx, dz));

    this.weaponT -= dt;
    if (this.weaponT <= 0 && !ch.using) {
      this.weaponT = 0.9;
      const w = this.bestWeapon(d);
      if (w > 0 && w !== ch.selected) ch.selectSlot(w);
      else if (w < 0 && ch.selected !== 0) ch.selectSlot(0);
    }

    this.aimErrT -= dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = 0.2 + this.rng.next() * 0.3;
      const e = (1 - this.skill) * 0.11 + 0.015;
      this.aimErrYaw = (this.rng.next() - 0.5) * 2 * e;
      this.aimErrPitch = (this.rng.next() - 0.5) * e;
    }
    const lead = this.targetVisible ? this.skill * 0.12 : 0;
    const ax = dx + t.vel.x * lead * (d / 30), az = dz + t.vel.z * lead * (d / 30);
    const aimY = ty + (this.skill > 0.75 ? 1.45 : 1.15);
    const wantYaw = yawTo(ax, az) + this.aimErrYaw;
    const wantPitch = Math.atan2(aimY - ch.eyeY, d) + this.aimErrPitch;
    const turn = 4 + this.skill * 10;
    ch.yaw = dampAngle(ch.yaw, wantYaw, turn, dt);
    ch.pitch = damp(ch.pitch, wantPitch, turn, dt);

    const def = ch.def;
    const pref = def && def.kind === 'gun' ? PREF_DIST[def.type] : 1.4;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.5 + this.rng.next() * 1.1;
      this.strafeDir = this.rng.chance(0.65) ? -this.strafeDir : this.strafeDir;
    }
    let fwd = 0;
    if (d > pref * 1.3) fwd = 1;
    else if (d < pref * 0.6) fwd = -0.7;
    if (!this.targetVisible && !this.blockedByPiece) fwd = 1;
    const storm = g.storm;
    if (storm.isOutside(ch.pos.x, ch.pos.z)) {
      this.moveWorld(storm.cur.x - ch.pos.x, storm.cur.z - ch.pos.z);
      ch.sprint = true;
    } else {
      ch.move.x = this.targetVisible ? this.strafeDir * (0.45 + this.skill * 0.55) : 0;
      ch.move.z = fwd;
      ch.sprint = d > pref * 2.2;
    }
    if (this.targetVisible && this.rng.chance(dt * this.skill * 0.9)) ch.wantJump = true;
    if (def && def.kind === 'gun' && d > 22 && (def.type === 'ar' || def.type === 'sniper' || def.type === 'pistol')) ch.ads = this.rng.chance(this.skill);

    // Panic-build a wall (and sometimes a ramp) when shot.
    if (now - ch.lastHitT < 0.4 && this.buildCd <= 0 && ch.mats.wood >= BUILD_COST * 2 && this.rng.chance(0.2 + this.skill * 0.6) && d > 4) {
      this.buildCd = 2 + this.rng.next() * 4 * (1.2 - this.skill);
      this.panicBuild(wantYaw);
    }

    if (ch.using || ch.reloadT > 0 || !def) return;
    if (now < this.reactT) return;
    // Fire in bursts with short pauses instead of holding the trigger forever.
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      return;
    }
    this.burstT -= dt;
    if (this.burstT <= 0) {
      this.burstT = 0.5 + this.rng.next() * 0.9;
      this.pauseT = 0.25 + this.rng.next() * 0.8 * (1.3 - this.skill);
      return;
    }
    const yawErr = Math.abs(wrapAngle(wantYaw - ch.yaw));
    const aimOk = yawErr < 0.05 + 1.2 / d;
    const canShoot = this.targetVisible ? aimOk : this.blockedByPiece && now - this.lastSeenT < 2.5;
    if (!canShoot) return;
    if (def.kind === 'melee' && d > 2.6) return;
    if (def.type === 'sniper' && (!ch.ads || yawErr > 0.02) && this.rng.chance(0.7)) return;
    if (def.type === 'shotgun' && d > 30) return;
    _o.set(ch.pos.x, ch.eyeY, ch.pos.z);
    _d.set(-Math.sin(ch.yaw) * Math.cos(ch.pitch), Math.sin(ch.pitch), -Math.cos(ch.yaw) * Math.cos(ch.pitch));
    g.combat.tryAttack(ch, _o, _d);
  }

  panicBuild(yawToTarget) {
    const ch = this.ch, S = this.game.structures;
    const mat = ch.mats.stone >= BUILD_COST && this.rng.chance(0.4) ? 'stone' : 'wood';
    const place = (type, yaw) => {
      const t = computeBuildTarget(type, ch.pos, yaw, 0, type === 'ramp' && S.onRampFacing(ch.pos, yaw));
      if (ch.mats[mat] < BUILD_COST || !S.canPlace(t.type, t.i, t.j, t.k, t.dir)) return false;
      S.create(t.type, t.i, t.j, t.k, t.dir, mat, { owner: ch });
      ch.mats[mat] -= BUILD_COST;
      this.game.audio.play('build', ch.pos, 0.7);
      return true;
    };
    place('wall', yawToTarget);
    if (this.skill > 0.55 && this.rng.chance(0.5)) {
      place('ramp', yawToTarget);
      ch.wantJump = true;
    }
    if (this.skill > 0.8 && this.rng.chance(0.35)) {
      place('wall', yawToTarget + Math.PI / 2);
      place('wall', yawToTarget - Math.PI / 2);
    }
  }

  handleStuck(dt) {
    const ch = this.ch, g = this.game;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.5;
    const moved = Math.hypot(ch.pos.x - this.lastPos.x, ch.pos.z - this.lastPos.z);
    this.lastPos.copy(ch.pos);
    const wants = Math.hypot(ch.move.x, ch.move.z) > 0.3 && this.breakT <= 0;
    if (!wants || moved > 0.9) {
      this.stuckT = 0;
      return;
    }
    this.stuckT += 0.5;
    if (this.stuckT >= 0.5) ch.wantJump = true;
    if (this.stuckT >= 1.5) {
      this.stuckT = 0;
      const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
      const hit = g.collision.raycast(ch.pos.x, ch.pos.y + 1.0, ch.pos.z, fx, 0, fz, 2.4);
      const owner = hit && hit.collider && hit.collider.owner;
      if (owner && (owner.isPiece || (owner.isProp && this.rng.chance(0.3)))) {
        this.breakTarget = owner;
        this.breakT = 4;
      } else {
        this.detourT = 1.0 + this.rng.next();
        this.detourYaw = ch.yaw + (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 2 + this.rng.float(-0.4, 0.4));
      }
    }
  }
}


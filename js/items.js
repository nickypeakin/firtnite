import * as THREE from 'three';
import { LOOT, WEAPONS, CONSUMABLES, AMMO, RARITIES } from './config.js';
import { createPickupVisual, createChestModel } from './models.js';
import { getTextures } from './textures.js';

export function itemName(item) {
  if (item.kind === 'weapon') return `${RARITIES[item.rarity].name} ${WEAPONS[item.id].name}`;
  if (item.kind === 'consumable') return `${CONSUMABLES[item.id].name} ×${item.count}`;
  if (item.kind === 'ammo') return `${AMMO[item.id].name} ×${item.count}`;
  if (item.kind === 'mats') return `${item.id[0].toUpperCase()}${item.id.slice(1)} ×${item.count}`;
  return '?';
}

export function makeWeapon(id, rarity) {
  return { kind: 'weapon', id, rarity, mag: WEAPONS[id].mag };
}

export class ItemManager {
  constructor(game, rng) {
    this.game = game;
    this.rng = rng;
    this.pickups = [];
    this.chests = [];
    this.glowMat = new THREE.SpriteMaterial({ map: getTextures().glow, color: 0xffd25a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    this.time = 0;
  }

  rollWeapon(rarityWeights) {
    const id = this.rng.weighted(LOOT.weapons);
    let rarity = this.rng.weightedIndex(rarityWeights);
    if (id === 'rocket') rarity = Math.max(2, rarity);
    if (id === 'sniper') rarity = Math.max(1, rarity);
    return makeWeapon(id, rarity);
  }

  rollConsumable() {
    const id = this.rng.weighted(LOOT.consumables);
    return { kind: 'consumable', id, count: CONSUMABLES[id].give };
  }

  ammoFor(weaponId, mult = 1) {
    const a = WEAPONS[weaponId].ammo;
    return { kind: 'ammo', id: a, count: Math.round(AMMO[a].give * mult) };
  }

  spawnFloorLoot(spot) {
    const r = this.rng.next();
    if (r < 0.55) {
      const w = this.rollWeapon(LOOT.floorRarity);
      this.spawnPickup(w, spot.x, spot.y, spot.z, false);
      this.spawnPickup(this.ammoFor(w.id), spot.x + 0.6, spot.y, spot.z + 0.3, false);
    } else if (r < 0.82) {
      this.spawnPickup(this.rollConsumable(), spot.x, spot.y, spot.z, false);
    } else {
      const ammo = this.rng.pick(['light', 'medium', 'heavy', 'shells']);
      this.spawnPickup({ kind: 'ammo', id: ammo, count: AMMO[ammo].give }, spot.x, spot.y, spot.z, false);
    }
  }

  spawnPickup(item, x, y, z, toss = true) {
    const mesh = createPickupVisual(item);
    const ground = this.game.collision.groundAt(x, z, y + 0.6);
    const p = {
      item, mesh, alive: true,
      pos: new THREE.Vector3(x, toss ? y + 0.6 : ground, z),
      vel: toss ? new THREE.Vector3((Math.random() - 0.5) * 4, 4 + Math.random() * 2, (Math.random() - 0.5) * 4) : new THREE.Vector3(),
      settled: !toss,
      phase: Math.random() * 6,
      noPickupT: toss ? 0.6 : 0,
    };
    mesh.position.copy(p.pos);
    this.game.scene.add(mesh);
    this.pickups.push(p);
    return p;
  }

  removePickup(p) {
    if (!p.alive) return;
    p.alive = false;
    this.game.scene.remove(p.mesh);
    p.mesh.traverse((o) => {
      if (o.userData.disposable) o.geometry.dispose();
    });
  }

  spawnChest(spot) {
    const mesh = createChestModel();
    mesh.position.set(spot.x, spot.y, spot.z);
    mesh.rotation.y = spot.rotY || 0;
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(2.6);
    glow.position.y = 0.5;
    mesh.add(glow);
    this.game.scene.add(mesh);
    const chest = { pos: new THREE.Vector3(spot.x, spot.y, spot.z), mesh, glow, opened: false, openT: 0 };
    this.chests.push(chest);
    return chest;
  }

  openChest(chest, ch) {
    if (chest.opened) return;
    chest.opened = true;
    chest.glow.visible = false;
    chest.openT = 0.0001;
    const { x, y, z } = chest.pos;
    const w = this.rollWeapon(LOOT.chestRarity);
    this.spawnPickup(w, x, y + 0.4, z);
    this.spawnPickup(this.ammoFor(w.id, 1.5), x, y + 0.4, z);
    if (this.rng.chance(0.75)) this.spawnPickup(this.rollConsumable(), x, y + 0.4, z);
    this.spawnPickup({ kind: 'mats', id: 'wood', count: 30 }, x, y + 0.4, z);
    this.game.audio.play('chest', ch && ch.isPlayer ? null : chest.pos, 0.9);
  }

  // Dropped inventory on elimination.
  dropAll(ch) {
    const { x, y, z } = ch.pos;
    for (let i = 1; i < 6; i++) {
      const it = ch.slots[i];
      if (it) this.spawnPickup({ ...it }, x, y + 0.8, z);
      ch.slots[i] = null;
    }
    for (const a of Object.keys(ch.ammo)) {
      if (ch.ammo[a] > 0) this.spawnPickup({ kind: 'ammo', id: a, count: ch.ammo[a] }, x, y + 0.8, z);
      ch.ammo[a] = 0;
    }
    for (const m of Object.keys(ch.mats)) {
      if (ch.mats[m] > 0) this.spawnPickup({ kind: 'mats', id: m, count: Math.min(ch.mats[m], 200) }, x, y + 0.8, z);
      ch.mats[m] = 0;
    }
  }

  // Characters walk over ammo/materials to collect them automatically.
  autoCollect(ch, p) {
    const k = p.item.kind;
    return k === 'ammo' || k === 'mats';
  }

  pickup(ch, p, swapSlot = -1) {
    if (!p.alive) return false;
    const item = p.item;
    if (item.kind === 'weapon' && ch.freeSlot() < 0) {
      // Swap with the selected slot (or a given one).
      const slot = swapSlot > 0 ? swapSlot : ch.selected > 0 ? ch.selected : -1;
      if (slot < 0) {
        if (ch.isPlayer) this.game.hud.toast('Inventory full: select a slot to swap');
        return false;
      }
      const old = ch.slots[slot];
      ch.slots[slot] = { ...item };
      ch.fireCd = Math.max(ch.fireCd, 0.25);
      ch.reloadT = 0;
      if (old) this.spawnPickup(old, ch.pos.x, ch.pos.y + 0.6, ch.pos.z);
      this.removePickup(p);
      this.afterPickup(ch, item);
      return true;
    }
    const before = item.count;
    const taken = ch.addItem(item);
    if (!taken && (item.kind !== 'consumable' || item.count === before)) {
      if (ch.isPlayer && item.kind === 'consumable') this.game.hud.toast('Inventory full');
      return false;
    }
    if (taken) this.removePickup(p);
    else p.mesh.userData.dirty = true;
    this.afterPickup(ch, item);
    return true;
  }

  afterPickup(ch, item) {
    if (ch.isPlayer) {
      this.game.audio.play('pickup');
      this.game.hud.pickupNotice(item);
    }
  }

  nearestInteractable(ch, maxDist = 2.6) {
    let best = null, bestD = maxDist;
    const fx = -Math.sin(ch.yaw), fz = -Math.cos(ch.yaw);
    for (const p of this.pickups) {
      if (!p.alive || !p.settled || this.autoCollect(ch, p)) continue;
      const dx = p.pos.x - ch.pos.x, dz = p.pos.z - ch.pos.z, dy = p.pos.y - ch.pos.y;
      if (Math.abs(dy) > 2.2) continue;
      // Favor items in front of the character.
      const d = Math.hypot(dx, dz) - Math.max(0, (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz))) * 0.6;
      if (d < bestD) { bestD = d; best = { type: 'pickup', obj: p }; }
    }
    for (const c of this.chests) {
      if (c.opened) continue;
      const dx = c.pos.x - ch.pos.x, dz = c.pos.z - ch.pos.z, dy = c.pos.y - ch.pos.y;
      if (Math.abs(dy) > 2) continue;
      const d = Math.hypot(dx, dz) - 0.3;
      if (d < bestD) { bestD = d; best = { type: 'chest', obj: c }; }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    const g = this.game;
    const cam = g.camera.position;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (!p.alive) {
        this.pickups.splice(i, 1);
        continue;
      }
      if (p.noPickupT > 0) p.noPickupT -= dt;
      if (!p.settled) {
        p.vel.y -= 22 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const ground = g.collision.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.5);
        if (p.pos.y <= ground) {
          p.pos.y = ground;
          p.settled = true;
          p.vel.set(0, 0, 0);
        }
      } else if (p.pos.y > g.collision.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1) + 0.05) {
        p.settled = false; // the floor under it was destroyed
      }
      p.mesh.position.copy(p.pos);
      const cdx = p.pos.x - cam.x, cdz = p.pos.z - cam.z;
      p.mesh.visible = cdx * cdx + cdz * cdz < 95 * 95;
      if (!p.mesh.visible) continue;
      const spin = p.mesh.userData.spin;
      spin.rotation.y += dt * 1.2;
      spin.position.y = 0.45 + Math.sin(this.time * 2 + p.phase) * 0.08;
    }
    for (const c of this.chests) {
      const cdx = c.pos.x - cam.x, cdz = c.pos.z - cam.z;
      c.mesh.visible = cdx * cdx + cdz * cdz < 170 * 170;
      if (c.openT > 0 && c.openT < 1) {
        c.openT = Math.min(1, c.openT + dt * 3);
        c.mesh.userData.lid.rotation.x = -c.openT * 1.9;
      }
      if (!c.opened) c.glow.material.opacity = 0.55 + Math.sin(this.time * 3) * 0.25;
    }
    // Auto-collect ammo and materials.
    for (const ch of g.characters) {
      if (!ch.alive || ch.state !== 'ground') continue;
      for (const p of this.pickups) {
        if (!p.alive || !p.settled || p.noPickupT > 0 || !this.autoCollect(ch, p)) continue;
        const dx = p.pos.x - ch.pos.x, dz = p.pos.z - ch.pos.z;
        if (dx * dx + dz * dz < 2.2 && Math.abs(p.pos.y - ch.pos.y) < 1.5) this.pickup(ch, p);
      }
    }
  }
}

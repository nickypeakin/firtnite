import * as THREE from 'three';
import { BOT_NAMES } from './config.js';
import { RNG, damp } from './util.js';
import { Terrain } from './terrain.js';
import { CollisionWorld } from './collision.js';
import { StructureManager } from './structures.js';
import { World } from './world.js';
import { ItemManager } from './items.js';
import { Effects } from './effects.js';
import { Combat } from './combat.js';
import { Storm } from './storm.js';
import { BattleBus } from './bus.js';
import { Character } from './character.js';
import { PlayerController } from './player.js';
import { Bot } from './bot.js';
import { HUD } from './hud.js';
import { randomSkin, PLAYER_SKIN } from './models.js';

const FOG_DAY = new THREE.Color(0xcfe9ff);
const FOG_STORM = new THREE.Color(0x6a2aa8);

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export class Game {
  // opts: { renderer, input, audio, settings, onEnd }
  constructor(opts) {
    this.opts = opts;
    this.renderer = opts.renderer;
    this.input = opts.input;
    this.audio = opts.audio;
    this.settings = opts.settings;
    const seed = opts.seed ?? opts.settings.seed ?? Math.floor(Math.random() * 1e9);
    this.seed = seed;
    this.rng = new RNG(seed);
    this.time = 0;
    this.over = false;
    this.result = null;
    this.spectateTarget = null;
    this.stormFog = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.setupLights();

    this.terrain = new Terrain(new RNG(seed ^ 0x51f2));
    this.world = new World(this, new RNG(seed + 7));
    this.world.planPOIs();
    this.terrain.generate();
    this.scene.add(this.terrain.buildMesh());
    this.collision = new CollisionWorld(this.terrain);
    this.effects = new Effects(this);
    this.structures = new StructureManager(this);
    this.world.build();

    this.items = new ItemManager(this, new RNG(seed + 11));
    for (const s of this.world.chestSpots) this.items.spawnChest(s);
    for (const s of this.world.lootSpots) this.items.spawnFloorLoot(s);

    this.combat = new Combat(this);
    this.storm = new Storm(this, new RNG(seed + 13));
    this.bus = new BattleBus(this, new RNG(seed + 17));

    this.characters = [];
    this.bots = [];
    const me = new Character(this, { name: this.settings.name || 'You', skin: PLAYER_SKIN, isPlayer: true });
    this.characters.push(me);
    const names = [...BOT_NAMES].sort(() => this.rng.next() - 0.5);
    const botCount = Math.max(1, Math.min(99, this.settings.bots | 0));
    for (let i = 0; i < botCount; i++) {
      const name = names[i % names.length] + (i >= names.length ? `${i}` : '');
      const ch = new Character(this, { name, skin: randomSkin(this.rng) });
      this.characters.push(ch);
      this.bots.push(new Bot(this, ch, new RNG(seed + 100 + i), this.settings.difficulty));
    }
    for (const ch of this.characters) ch.setPosition(this.bus.position.x, this.bus.position.y, this.bus.position.z);
    this.planDrops();
    this.aliveCount = this.characters.length;

    this.player = new PlayerController(this, me, this.settings);
    this.hud = new HUD(this);
    this.hud.show(true);
    this.hud.centerMessage('Welcome to Firtnite!', 3);
    this.audio.play('horn');
  }

  setupLights() {
    const scene = this.scene;
    scene.fog = new THREE.Fog(FOG_DAY.clone(), 170, 640);
    this.hemi = new THREE.HemisphereLight(0xe2f3ff, 0x6f8f4c, 1.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.3);
    this.sunOffset = new THREE.Vector3(70, 130, 45);
    if (this.settings.quality !== 'low') {
      const s = this.sun;
      s.castShadow = true;
      s.shadow.mapSize.set(2048, 2048);
      const c = s.shadow.camera;
      c.left = -70; c.right = 70; c.top = 70; c.bottom = -70;
      c.near = 10; c.far = 420;
      s.shadow.bias = -0.0005;
      s.shadow.normalBias = 0.05;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  // Bots pick spread-out landing spots near the bus route and jump when the bus passes them.
  planDrops() {
    const bus = this.bus;
    const len = bus.start.distanceTo(bus.end);
    const reach = (s) => Math.abs((s.x - bus.start.x) * bus.dir.z - (s.z - bus.start.z) * bus.dir.x) < 150;
    const spots = [
      ...this.world.chestSpots.map((c) => ({ x: c.x, z: c.z })),
      ...this.world.lootSpots.map((c) => ({ x: c.x, z: c.z })),
    ].filter(reach).sort(() => this.rng.next() - 0.5);
    const taken = [];
    const farEnough = (s, min) => taken.every((t) => Math.hypot(t.x - s.x, t.z - s.z) > min);
    for (const b of this.bots) {
      let spot = spots.find((s) => farEnough(s, 35)) || spots.find((s) => farEnough(s, 15));
      if (!spot) spot = { x: b.rng.float(-150, 150), z: b.rng.float(-150, 150) };
      taken.push(spot);
      b.dropTarget = { x: spot.x + b.rng.float(-4, 4), z: spot.z + b.rng.float(-4, 4) };
      const along = (b.dropTarget.x - bus.start.x) * bus.dir.x + (b.dropTarget.z - bus.start.z) * bus.dir.z;
      const tClosest = (along / len) * bus.duration;
      b.jumpAt = Math.max(1.5 + b.rng.next() * 2, Math.min(bus.duration - 0.5, tClosest - b.rng.float(1.5, 4)));
    }
  }

  jumpFromBus(ch) {
    if (ch.state !== 'bus' || !ch.alive) return;
    const p = this.bus.position;
    ch.jumpFromBus(p);
    if (!ch.isPlayer) {
      ch.pos.x += (Math.random() - 0.5) * 4;
      ch.pos.z += (Math.random() - 0.5) * 4;
    } else {
      this.audio.play('jump', null, 0.8);
      this.hud.centerMessage(this.input.touch ? 'Steer with the joystick · tap JUMP to glide' : 'Steer with WASD · SPACE opens the glider', 3);
    }
    ch.yaw = Math.atan2(-this.bus.dir.x, -this.bus.dir.z);
  }

  onBusFinished() {
    for (const ch of this.characters) if (ch.state === 'bus') this.jumpFromBus(ch);
  }

  noise(source, radius) {
    for (const b of this.bots) {
      if (b.ch === source || !b.ch.alive || b.ch.state !== 'ground') continue;
      const d = Math.hypot(b.ch.pos.x - source.pos.x, b.ch.pos.z - source.pos.z);
      if (d < radius) b.heard = { x: source.pos.x, z: source.pos.z, t: this.time };
    }
  }

  displayName(ch) {
    return ch.isPlayer ? `<b class="me">${esc(ch.name)}</b>` : esc(ch.name);
  }

  applyDamage(target, amount, source, info = {}) {
    if (!target.alive || amount <= 0 || target.state === 'bus') return;
    if (source && source.dmgMult) amount *= source.dmgMult;
    const hadShield = target.shield > 0;
    let sd = 0;
    if (!info.ignoreShield && target.shield > 0) {
      sd = Math.min(target.shield, amount);
      target.shield -= sd;
      amount -= sd;
    }
    const hd = Math.min(target.health, amount);
    target.health -= hd;
    if (source && source !== target) {
      target.lastHitBy = source;
      target.lastHitT = this.time;
    }
    const total = sd + hd;
    if (source && source.isPlayer && target !== source && total > 0) {
      const kill = target.health <= 0;
      this.hud.hitMarker(info.headshot, kill);
      const p = info.point || target.pos.clone().setY(target.pos.y + 1.6);
      this.hud.damageNumber(p, total, info.headshot ? 'head' : sd > 0 ? 'shield' : 'health');
      this.audio.play(info.headshot ? 'headshot' : sd > 0 ? 'shieldhit' : 'hit');
      if (hadShield && target.shield <= 0) this.audio.play('shieldbreak');
    }
    if (target.isPlayer && total > 0) {
      if (source && source !== target) this.hud.damageFrom(source.pos.x, source.pos.z);
      if (!info.storm) this.audio.play('hurt');
      this.player.addShake(0.12 + Math.min(0.3, total / 200));
    }
    if (target.health <= 0) this.eliminate(target, source, info);
  }

  eliminate(victim, killer, info) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hittable = false;
    victim.health = 0;
    victim.using = null;
    this.effects.elimination(victim.pos);
    this.audio.play('elim', victim.isPlayer ? null : victim.pos, 0.5);
    this.items.dropAll(victim);
    victim.model.root.visible = false;
    this.aliveCount--;
    const weapon = esc(info.weapon || 'something');
    if (killer && killer !== victim) {
      killer.kills++;
      this.hud.killfeed(`${this.displayName(killer)} eliminated ${this.displayName(victim)} <span class="w">${weapon}</span>`);
    } else {
      this.hud.killfeed(`${this.displayName(victim)} was eliminated by <span class="w">${weapon}</span>`);
    }
    if (killer && killer.isPlayer && victim !== killer) {
      this.hud.centerMessage(`You eliminated ${victim.name}`, 2.2, 'elim');
      this.audio.play('elim', null, 0.6);
    }
    if (victim.isPlayer) {
      this.result = { victory: false, placement: this.aliveCount + 1, kills: victim.kills, killer: killer && killer !== victim ? killer.name : info.weapon, time: this.time };
      this.player.orbitYaw = victim.yaw;
      this.spectateTarget = killer && killer.alive ? killer : this.randomAlive();
      setTimeout(() => this.opts.onEnd && this.opts.onEnd(this.result), 2200);
    }
    if (this.spectateTarget === victim) this.spectateTarget = killer && killer.alive ? killer : this.randomAlive();
    this.checkEnd();
  }

  randomAlive() {
    const alive = this.characters.filter((c) => c.alive);
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
  }

  checkEnd() {
    if (this.aliveCount > 1 || this.over) return;
    this.over = true;
    const me = this.player.ch;
    const winner = this.characters.find((c) => c.alive);
    if (me.alive) {
      this.result = { victory: true, placement: 1, kills: me.kills, time: this.time };
      this.audio.play('victory');
      this.hud.centerMessage('#1 VICTORY!', 6, 'victory');
      setTimeout(() => this.opts.onEnd && this.opts.onEnd(this.result), 2500);
    } else if (winner) {
      this.hud.centerMessage(`${winner.name} wins the match`, 6);
      if (this.opts.onWinner) this.opts.onWinner(winner.name);
    }
  }

  separateCharacters() {
    const cs = this.characters;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (!a.alive || a.state === 'bus') continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (!b.alive || b.state === 'bus') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        if (Math.abs(dx) > 0.8 || Math.abs(dz) > 0.8 || Math.abs(b.pos.y - a.pos.y) > 1.8) continue;
        const d = Math.hypot(dx, dz);
        if (d < 0.8 && d > 1e-4) {
          const push = (0.8 - d) * 0.5;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  update(dt) {
    this.time += dt;
    if (this.bus.mesh.visible) this.bus.update(dt);
    for (const ch of this.characters) if (ch.state === 'bus') ch.pos.copy(this.bus.position);

    this.player.update(dt);
    for (const b of this.bots) b.update(dt);
    for (const ch of this.characters) {
      if (!ch.alive) continue;
      this.combat.update(ch, dt);
      ch.updateMovement(dt);
    }
    this.separateCharacters();
    this.combat.updateProjectiles(dt);
    this.structures.update(dt);
    this.world.update(dt);
    this.items.update(dt);
    this.storm.update(dt);
    this.effects.update(dt);

    if (!this.player.ch.alive && (!this.spectateTarget || !this.spectateTarget.alive)) this.spectateTarget = this.randomAlive();
    this.player.updateCamera(dt);
    const camPos = this.camera.position;
    for (const ch of this.characters) ch.updateVisual(dt, camPos);

    const focus = this.spectateTarget || this.player.ch;
    const fp = focus.state === 'bus' ? this.bus.position : focus.pos;
    this.sun.target.position.set(Math.round(fp.x), 0, Math.round(fp.z));
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.sun.target.position.y = fp.y;
    this.sun.position.y += fp.y;

    const inStorm = focus.alive && focus.state !== 'bus' && this.storm.isOutside(fp.x, fp.z);
    this.stormFog = damp(this.stormFog, inStorm ? 1 : 0, 3, dt);
    this.scene.fog.color.copy(FOG_DAY).lerp(FOG_STORM, this.stormFog);
    this.scene.fog.near = 170 - this.stormFog * 150;
    this.scene.fog.far = 640 - this.stormFog * 520;

    this.hud.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
    if (this.sun.shadow && this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.hud.show(false);
  }
}

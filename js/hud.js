import * as THREE from 'three';
import { WEAPONS, CONSUMABLES, RARITIES, AMMO, WORLD } from './config.js';
import { formatTime } from './util.js';
import { itemName } from './items.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

const SHORT = { ar: 'AR', smg: 'SMG', shotgun: 'PUMP', sniper: 'SNIPER', pistol: 'PISTOL', rocket: 'ROCKET' };
const CONS_SHORT = { bandage: 'BANDAGE', medkit: 'MEDKIT', minishield: 'MINI', shieldpot: 'BIG POT' };
const PIECES = [['wall', 'Z', 'Wall'], ['floor', 'X', 'Floor'], ['ramp', 'C', 'Ramp'], ['cone', 'V', 'Roof']];

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {};
    for (const id of ['alive', 'kills', 'storm-text', 'storm-time', 'killfeed', 'center-msg', 'toast', 'prompt', 'prompt-text',
      'usebar', 'usebar-fill', 'usebar-label', 'target-hp', 'target-hp-fill', 'shield-fill', 'shield-num', 'health-fill', 'health-num',
      'mat-wood', 'mat-stone', 'mat-metal', 'ammo-mag', 'ammo-reserve', 'hotbar', 'buildbar', 'pickup-feed', 'spectate',
      'bigmap', 'bus-hint', 'scope', 'storm-overlay', 'damage-vignette', 'hitmarker', 'crosshair', 'dmgnums', 'dmg-dirs', 'minimap', 'mats']) {
      this.el[id] = $(id);
    }
    for (const id of ['killfeed', 'pickup-feed', 'dmgnums', 'dmg-dirs']) this.el[id].innerHTML = '';
    this.mini = this.el.minimap.getContext('2d');
    this.big = this.el.bigmap.getContext('2d');
    this.mapImage = game.terrain.buildMapImage(512);
    this.miniT = 0;
    this.centerT = 0;
    this.toastT = 0;
    this.hitT = 0;
    this.targetHpT = 0;
    this.hotbarSig = '';
    this.buildSig = '';
    this.bigMapOpen = false;

    this.slots = [];
    this.el.hotbar.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<span class="key">${i + 1}</span><span class="name"></span><span class="count"></span>`;
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        game.input.virtualPress(`Digit${i + 1}`);
      });
      this.el.hotbar.appendChild(s);
      this.slots.push(s);
    }
    this.el.buildbar.innerHTML = '';
    this.pieceEls = PIECES.map(([type, key, label]) => {
      const d = document.createElement('div');
      d.className = 'piece';
      d.dataset.type = type;
      d.innerHTML = `<span class="key">${key}</span><span class="icon icon-${type}"></span><span class="name">${label}</span>`;
      this.el.buildbar.appendChild(d);
      return d;
    });
    this.matEl = document.createElement('div');
    this.matEl.className = 'piece mat-pick';
    this.el.buildbar.appendChild(this.matEl);

    this.dmgNums = [];
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div');
      d.className = 'dmgnum';
      this.el.dmgnums.appendChild(d);
      this.dmgNums.push({ el: d, life: 0, pos: new THREE.Vector3(), rise: 0 });
    }
    this.dmgIdx = 0;
    this.dirs = [];
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'dmgdir';
      this.el['dmg-dirs'].appendChild(d);
      this.dirs.push({ el: d, life: 0, x: 0, z: 0 });
    }
    this.dirIdx = 0;
  }

  show(v) {
    this.root.hidden = !v;
  }

  centerMessage(text, seconds = 2.5, style = '') {
    const e = this.el['center-msg'];
    e.textContent = text;
    e.className = `show ${style}`;
    this.centerT = seconds;
  }

  toast(text, seconds = 1.6) {
    const e = this.el.toast;
    e.textContent = text;
    e.classList.add('show');
    this.toastT = seconds;
  }

  killfeed(html) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = html;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 6000);
    setTimeout(() => d.remove(), 7000);
  }

  pickupNotice(item) {
    const d = document.createElement('div');
    d.className = 'pf';
    const color = item.kind === 'weapon' ? RARITIES[item.rarity].color : item.kind === 'consumable' ? RARITIES[CONSUMABLES[item.id].rarity].color : '#ffffff';
    d.style.borderLeftColor = color;
    d.textContent = `+ ${itemName(item)}`;
    this.el['pickup-feed'].prepend(d);
    while (this.el['pickup-feed'].children.length > 4) this.el['pickup-feed'].lastChild.remove();
    setTimeout(() => d.remove(), 2600);
  }

  harvested(mat, amount) {
    const d = document.createElement('div');
    d.className = `harvest h-${mat}`;
    d.textContent = `+${amount}`;
    const holder = this.el.mats.querySelector(`[data-mat="${mat}"]`);
    if (holder) {
      holder.appendChild(d);
      setTimeout(() => d.remove(), 800);
    }
  }

  hitMarker(head, kill) {
    const e = this.el.hitmarker;
    e.className = `show${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    this.hitT = kill ? 0.3 : 0.14;
  }

  // kind: 'health' | 'shield' | 'head' | 'build'
  damageNumber(pos, amount, kind) {
    const n = this.dmgNums[this.dmgIdx];
    this.dmgIdx = (this.dmgIdx + 1) % this.dmgNums.length;
    n.pos.copy(pos);
    n.pos.x += (Math.random() - 0.5) * 0.6;
    n.pos.y += 0.3 + Math.random() * 0.3;
    n.life = 0.9;
    n.rise = 0;
    n.el.textContent = Math.round(amount);
    n.el.className = `dmgnum show ${kind}`;
  }

  damageFrom(x, z) {
    const d = this.dirs[this.dirIdx];
    this.dirIdx = (this.dirIdx + 1) % this.dirs.length;
    d.x = x;
    d.z = z;
    d.life = 1.2;
  }

  showTargetHp(piece) {
    this.targetPiece = piece;
    this.targetHpT = 1.5;
  }

  toggleBigMap(force) {
    this.bigMapOpen = force !== undefined ? force : !this.bigMapOpen;
    this.el.bigmap.hidden = !this.bigMapOpen;
  }

  updateHotbar(ch) {
    let sig = `${ch.selected}|`;
    for (let i = 0; i < 6; i++) {
      const s = ch.slots[i];
      sig += s ? `${s.kind}${s.id}${s.rarity}${s.count}${s.mag},` : '-,';
    }
    if (sig === this.hotbarSig) return;
    this.hotbarSig = sig;
    for (let i = 0; i < 6; i++) {
      const it = ch.slots[i];
      const el = this.slots[i];
      el.classList.toggle('selected', ch.selected === i);
      el.classList.toggle('empty', !it);
      let name = '', count = '', color = 'rgba(30,40,60,0.55)';
      if (it) {
        if (it.kind === 'pickaxe') { name = 'PICKAXE'; color = 'rgba(80,90,110,0.8)'; }
        else if (it.kind === 'weapon') { name = SHORT[it.id]; color = RARITIES[it.rarity].color; count = `${it.mag}`; }
        else if (it.kind === 'consumable') { name = CONS_SHORT[it.id]; color = RARITIES[CONSUMABLES[it.id].rarity].color; count = `×${it.count}`; }
      }
      el.style.setProperty('--rar', color);
      el.querySelector('.name').textContent = name;
      el.querySelector('.count').textContent = count;
    }
  }

  updateBuildbar(pc) {
    const sig = `${pc.mode}|${pc.buildType}|${pc.buildMat}|${pc.ch.mats[pc.buildMat]}`;
    if (sig === this.buildSig) return;
    this.buildSig = sig;
    const on = pc.mode === 'build';
    this.el.buildbar.hidden = !on;
    document.body.classList.toggle('building', on);
    this.el.hotbar.classList.toggle('dim', on);
    for (const p of this.pieceEls) p.classList.toggle('selected', on && p.dataset.type === pc.buildType);
    this.matEl.className = `piece mat-pick m-${pc.buildMat}`;
    this.matEl.innerHTML = `<span class="key">${this.game.input.touch ? 'MAT' : 'RMB'}</span><span class="name">${pc.buildMat.toUpperCase()}</span>`;
    for (const m of ['wood', 'stone', 'metal']) {
      this.el.mats.querySelector(`[data-mat="${m}"]`).classList.toggle('active', on && m === pc.buildMat);
    }
  }

  update(dt) {
    const g = this.game;
    const pc = g.player;
    const ch = pc.ch;
    const view = g.spectateTarget || ch;

    this.el.alive.textContent = g.aliveCount;
    this.el.kills.textContent = ch.kills;
    const lbl = g.storm.label();
    this.el['storm-text'].textContent = lbl.text;
    this.el['storm-time'].textContent = lbl.time > 0 ? formatTime(lbl.time) : '';

    const hp = Math.max(0, view.health), sh = Math.max(0, view.shield);
    this.el['health-fill'].style.width = `${hp}%`;
    this.el['health-num'].textContent = Math.ceil(hp);
    this.el['shield-fill'].style.width = `${sh}%`;
    this.el['shield-num'].textContent = Math.ceil(sh);
    this.el['damage-vignette'].style.opacity = view.alive && hp < 35 ? (0.5 - hp / 70) + Math.sin(performance.now() / 200) * 0.08 : 0;

    this.el['mat-wood'].textContent = ch.mats.wood;
    this.el['mat-stone'].textContent = ch.mats.stone;
    this.el['mat-metal'].textContent = ch.mats.metal;

    this.updateHotbar(ch);
    this.updateBuildbar(pc);

    const it = ch.item;
    if (it && it.kind === 'weapon' && pc.mode !== 'build') {
      const def = WEAPONS[it.id];
      this.el['ammo-mag'].textContent = ch.reloadT > 0 ? 'RELOADING' : it.mag;
      this.el['ammo-reserve'].textContent = ` / ${ch.ammo[def.ammo]}`;
      this.el['ammo-reserve'].style.color = AMMO[def.ammo].color;
    } else {
      this.el['ammo-mag'].textContent = '';
      this.el['ammo-reserve'].textContent = '';
    }

    // Crosshair spread.
    const def = ch.def;
    let spread = 0;
    if (def && def.kind === 'gun') spread = g.combat.currentSpread(ch, def);
    const px = 6 + spread * 420;
    this.el.crosshair.style.setProperty('--gap', `${Math.min(70, px)}px`);
    this.el.crosshair.classList.toggle('build', pc.mode === 'build');
    this.el.crosshair.hidden = !ch.alive || ch.state === 'bus' || pc.scoped;
    this.el.scope.hidden = !pc.scoped;
    this.el['storm-overlay'].classList.toggle('on', view.alive && view.state !== 'bus' && g.storm.isOutside(view.pos.x, view.pos.z));

    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.el.hitmarker.className = '';
    }
    if (this.centerT > 0) {
      this.centerT -= dt;
      if (this.centerT <= 0) this.el['center-msg'].className = '';
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.classList.remove('show');
    }

    // Interaction prompt.
    const inter = ch.alive && ch.state === 'ground' ? pc.interactTarget : null;
    if (inter) {
      this.el.prompt.hidden = false;
      let txt, color = '#fff';
      if (inter.type === 'chest') txt = 'Open Chest';
      else {
        const item = inter.obj.item;
        txt = `${ch.freeSlot() < 0 && item.kind === 'weapon' ? 'Swap for' : 'Pick up'} ${itemName(item)}`;
        if (item.kind === 'weapon') color = RARITIES[item.rarity].color;
        else if (item.kind === 'consumable') color = RARITIES[CONSUMABLES[item.id].rarity].color;
      }
      this.el['prompt-text'].textContent = txt;
      this.el['prompt-text'].style.color = color;
      this.el.prompt.querySelector('kbd').textContent = g.input.touch ? 'USE' : 'E';
    } else {
      this.el.prompt.hidden = true;
    }

    // Use / reload progress.
    if (ch.using) {
      this.el.usebar.hidden = false;
      this.el['usebar-fill'].style.width = `${(ch.using.t / ch.using.dur) * 100}%`;
      this.el['usebar-label'].textContent = `${CONSUMABLES[ch.using.id].name} ${Math.max(0, ch.using.dur - ch.using.t).toFixed(1)}s`;
    } else if (ch.reloadT > 0 && it && it.kind === 'weapon') {
      const total = WEAPONS[it.id].reload[it.rarity];
      this.el.usebar.hidden = false;
      this.el['usebar-fill'].style.width = `${(1 - ch.reloadT / total) * 100}%`;
      this.el['usebar-label'].textContent = 'Reloading';
    } else {
      this.el.usebar.hidden = true;
    }

    if (this.targetHpT > 0 && this.targetPiece) {
      this.targetHpT -= dt;
      const p = this.targetPiece;
      this.el['target-hp'].hidden = this.targetHpT <= 0 || !p.alive;
      this.el['target-hp-fill'].style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    } else {
      this.el['target-hp'].hidden = true;
    }

    this.el['bus-hint'].hidden = !(ch.state === 'bus' && ch.alive);
    if (ch.state === 'bus') this.el['bus-hint'].textContent = g.input.touch ? 'Tap JUMP to drop from the bus' : 'Press SPACE to drop from the bus';

    this.el.spectate.hidden = !g.spectateTarget;
    if (g.spectateTarget) this.el.spectate.textContent = `Spectating ${g.spectateTarget.name} · ${g.input.touch ? 'tap' : 'Esc'} for menu`;

    this.updateDamageNumbers(dt);
    this.updateDamageDirs(dt, view);

    this.miniT -= dt;
    if (this.miniT <= 0) {
      this.miniT = 1 / 20;
      this.drawMinimap(view);
      if (this.bigMapOpen) this.drawBigMap(view);
    }
  }

  updateDamageNumbers(dt) {
    const cam = this.game.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (const n of this.dmgNums) {
      if (n.life <= 0) continue;
      n.life -= dt;
      n.rise += dt * 1.4;
      if (n.life <= 0) {
        n.el.className = 'dmgnum';
        continue;
      }
      _v.copy(n.pos);
      _v.y += n.rise;
      _v.project(cam);
      if (_v.z > 1) {
        n.el.style.opacity = 0;
        continue;
      }
      n.el.style.opacity = Math.min(1, n.life * 3);
      n.el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * w}px, ${(-_v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%) scale(${0.8 + Math.min(0.4, n.life)})`;
    }
  }

  updateDamageDirs(dt, view) {
    const yaw = view.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (const d of this.dirs) {
      if (d.life <= 0) {
        d.el.style.opacity = 0;
        continue;
      }
      d.life -= dt;
      const dx = d.x - view.pos.x, dz = d.z - view.pos.z;
      const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      d.el.style.opacity = Math.min(1, d.life * 1.5);
      d.el.style.transform = `translate(-50%, -50%) rotate(${a}rad) translateY(-130px)`;
    }
  }

  worldToMap(x, z, size, scale, cx, cz) {
    return [size / 2 + (x - cx) * scale, size / 2 + (z - cz) * scale];
  }

  drawCircles(ctx, size, scale, cx, cz) {
    const st = this.game.storm;
    const [sx, sy] = this.worldToMap(st.cur.x, st.cur.z, size, scale, cx, cz);
    ctx.fillStyle = 'rgba(140, 40, 220, 0.42)';
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(sx, sy, Math.max(0, st.cur.r * scale), 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(200, 120, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0, st.cur.r * scale), 0, Math.PI * 2);
    ctx.stroke();
    if (st.state !== 'done') {
      const [nx, ny] = this.worldToMap(st.next.x, st.next.z, size, scale, cx, cz);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nx, ny, Math.max(0, st.next.r * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawPlayerArrow(ctx, x, y, yaw, color = '#ffe14a', s = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-yaw);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8 * s);
    ctx.lineTo(5.5 * s, 6 * s);
    ctx.lineTo(0, 3 * s);
    ctx.lineTo(-5.5 * s, 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawBusPath(ctx, size, scale, cx, cz) {
    const bus = this.game.bus;
    if (!bus || bus.done) return;
    const [ax, ay] = this.worldToMap(bus.start.x, bus.start.z, size, scale, cx, cz);
    const [bx, by] = this.worldToMap(bus.end.x, bus.end.z, size, scale, cx, cz);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    const [px, py] = this.worldToMap(bus.position.x, bus.position.z, size, scale, cx, cz);
    ctx.fillStyle = '#4aa3ff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMinimap(view) {
    const ctx = this.mini, size = this.el.minimap.width;
    const range = 220;
    const scale = size / range;
    const cx = view.state === 'bus' ? this.game.bus.position.x : view.pos.x;
    const cz = view.state === 'bus' ? this.game.bus.position.z : view.pos.z;
    ctx.fillStyle = '#1d5d8f';
    ctx.fillRect(0, 0, size, size);
    const img = this.mapImage;
    const pxPerM = img.width / WORLD.size;
    ctx.drawImage(img, (cx - range / 2 + WORLD.size / 2) * pxPerM, (cz - range / 2 + WORLD.size / 2) * pxPerM, range * pxPerM, range * pxPerM, 0, 0, size, size);
    this.drawCircles(ctx, size, scale, cx, cz);
    this.drawBusPath(ctx, size, scale, cx, cz);
    if (view.state !== 'bus') this.drawPlayerArrow(ctx, size / 2, size / 2, view.yaw);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 12);
  }

  drawBigMap(view) {
    const ctx = this.big, size = this.el.bigmap.width;
    const scale = size / WORLD.size;
    ctx.fillStyle = '#1d5d8f';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.mapImage, 0, 0, size, size);
    this.drawCircles(ctx, size, scale, 0, 0);
    this.drawBusPath(ctx, size, scale, 0, 0);
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Barlow Condensed", sans-serif';
    for (const p of this.game.world.pois) {
      const [x, y] = this.worldToMap(p.x, p.z, size, scale, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(p.name.toUpperCase(), x + 1, y + 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.name.toUpperCase(), x, y);
    }
    const px = view.state === 'bus' ? this.game.bus.position.x : view.pos.x;
    const pz = view.state === 'bus' ? this.game.bus.position.z : view.pos.z;
    const [x, y] = this.worldToMap(px, pz, size, scale, 0, 0);
    this.drawPlayerArrow(ctx, x, y, view.yaw, '#ffe14a', 1.3);
  }
}

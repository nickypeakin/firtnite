import * as THREE from 'three';
import { BUILD_COST, MAT_ORDER, WEAPONS } from './config.js';
import { clamp, damp } from './util.js';
import { layout, computeBuildTarget } from './structures.js';
import { getTextures } from './textures.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _want = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const PIECE_KEYS = { KeyZ: 'wall', KeyX: 'floor', KeyC: 'ramp', KeyV: 'cone' };
const RECOIL = { ar: 0.006, smg: 0.003, shotgun: 0.03, sniper: 0.045, pistol: 0.01, rocket: 0.02 };

export class PlayerController {
  constructor(game, ch, settings) {
    this.game = game;
    this.ch = ch;
    this.input = game.input;
    this.camera = game.camera;
    this.settings = settings;
    this.mode = 'combat';
    this.buildType = 'wall';
    this.buildMat = 'wood';
    this.buildCd = 0;
    this.interactTarget = null;
    this.scoped = false;
    this.hideSelf = false;
    this.shake = 0;
    this.kick = 0;
    this.fov = 75;
    this.camDist = 3.4;
    this.orbitYaw = 0;
    this.orbitPitch = -0.3;
    this.camPos = new THREE.Vector3();
    this.buildTarget = null;

    const bp = getTextures().blueprint;
    this.previewOk = new THREE.MeshBasicMaterial({ map: bp, color: 0x9fd4ff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
    this.previewBad = new THREE.MeshBasicMaterial({ map: bp, color: 0xff6a6a, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.preview = new THREE.Mesh(game.structures.geometryFor('wall'), this.previewOk);
    this.preview.visible = false;
    this.preview.renderOrder = 10;
    game.scene.add(this.preview);
  }

  get sens() {
    return 0.0022 * (this.settings.sensitivity || 1);
  }

  addShake(a) {
    this.shake = Math.max(this.shake, a);
  }

  recoil(def) {
    const r = RECOIL[def.type] || 0.005;
    this.kick += r * (this.ch.ads ? 0.6 : 1);
    if (def.auto) this.ch.pitch = clamp(this.ch.pitch + r * 0.35, -1.45, 1.45);
  }

  selectSlot(i) {
    const ch = this.ch;
    if (this.mode === 'build') this.mode = 'combat';
    if (i === ch.selected) return;
    if (ch.selectSlot(i)) this.game.audio.play('click');
  }

  cycleSlot(d) {
    const ch = this.ch;
    for (let n = 1; n <= 6; n++) {
      const i = (ch.selected + d * n + 6) % 6;
      if (ch.slots[i]) {
        this.selectSlot(i);
        return;
      }
    }
  }

  forward(out, yaw, pitch) {
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  }

  // Aim ray from the eye toward whatever sits under the crosshair.
  computeAim() {
    const ch = this.ch, g = this.game;
    const cam = this.camera;
    cam.getWorldDirection(_dir);
    const eye = new THREE.Vector3(ch.pos.x, ch.eyeY, ch.pos.z);
    const t0 = Math.max(0, _tmp.copy(eye).sub(cam.position).dot(_dir));
    const o = _tmp.copy(cam.position).addScaledVector(_dir, t0);
    const hit = g.collision.raycast(o.x, o.y, o.z, _dir.x, _dir.y, _dir.z, 600, { characters: g.characters, ignoreChar: ch });
    const point = hit ? new THREE.Vector3(hit.x, hit.y, hit.z) : o.clone().addScaledVector(_dir, 600);
    const dir = point.clone().sub(eye);
    if (dir.length() < 1.2) dir.copy(_dir);
    dir.normalize();
    return { origin: eye, dir, point };
  }

  updateBuild(dt) {
    const g = this.game, ch = this.ch, inp = this.input;
    this.buildCd -= dt;
    const canBuild = ch.alive && ch.state === 'ground';
    if (!canBuild || this.mode !== 'build') {
      this.preview.visible = false;
      this.buildTarget = null;
      return;
    }
    const onRamp = this.buildType === 'ramp' && g.structures.onRampFacing(ch.pos, ch.yaw);
    const t = computeBuildTarget(this.buildType, ch.pos, ch.yaw, ch.pitch, onRamp);
    const valid = g.structures.canPlace(t.type, t.i, t.j, t.k, t.dir) && ch.mats[this.buildMat] >= BUILD_COST;
    const L = layout(t.type, t.i, t.j, t.k, t.dir);
    this.preview.geometry = g.structures.geometryFor(t.type);
    this.preview.position.set(L.x, L.y, L.z);
    this.preview.rotation.y = L.rotY;
    this.preview.material = valid ? this.previewOk : this.previewBad;
    this.preview.visible = !g.structures.isOccupied(t.type, t.i, t.j, t.k, t.dir);
    this.buildTarget = t;
    if (inp.isDown('Mouse0') && this.buildCd <= 0) {
      if (valid) {
        g.structures.create(t.type, t.i, t.j, t.k, t.dir, this.buildMat, { owner: ch });
        ch.mats[this.buildMat] -= BUILD_COST;
        g.audio.play('build');
        this.buildCd = 0.06;
      } else if (inp.wasPressed('Mouse0') && ch.mats[this.buildMat] < BUILD_COST) {
        g.hud.toast(`Not enough ${this.buildMat}: harvest with your pickaxe`);
      }
    }
  }

  cycleMaterial() {
    const i = MAT_ORDER.indexOf(this.buildMat);
    this.buildMat = MAT_ORDER[(i + 1) % MAT_ORDER.length];
    this.game.audio.play('click');
  }

  update(dt) {
    const g = this.game, ch = this.ch, inp = this.input;
    const zoomK = this.fov / 75;
    const s = this.sens * zoomK;
    if (inp.wasPressed('KeyM')) g.hud.toggleBigMap();

    if (!ch.alive) {
      this.orbitYaw -= inp.lookX * s;
      this.orbitPitch = clamp(this.orbitPitch - inp.lookY * s, -1.2, 0.6);
      this.preview.visible = false;
      return;
    }
    ch.yaw -= inp.lookX * s;
    ch.pitch = clamp(ch.pitch - inp.lookY * s, -1.45, 1.45);

    if (ch.state === 'bus') {
      if (inp.wasPressed('Space')) g.jumpFromBus(ch);
      return;
    }

    const mv = inp.moveVector();
    ch.move.x = mv.x;
    ch.move.z = mv.z;
    ch.sprint = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    if (inp.wasPressed('Space')) {
      if (ch.state === 'freefall') ch.deployGlider();
      else ch.wantJump = true;
    }
    if (inp.isDown('Space') && ch.state === 'ground' && ch.grounded) ch.wantJump = true;

    for (let i = 1; i <= 6; i++) if (inp.wasPressed(`Digit${i}`)) this.selectSlot(i - 1);
    if (inp.wheel) this.cycleSlot(inp.wheel > 0 ? 1 : -1);
    if (inp.wasPressed('KeyF')) this.selectSlot(0);
    if (inp.wasPressed('KeyQ')) {
      this.mode = this.mode === 'build' ? 'combat' : 'build';
      ch.ads = false;
      ch.using = null;
    }
    for (const code in PIECE_KEYS) {
      if (inp.wasPressed(code)) {
        this.mode = 'build';
        this.buildType = PIECE_KEYS[code];
        ch.ads = false;
        ch.using = null;
      }
    }
    if (inp.wasPressed('KeyG')) this.cycleMaterial();

    if (ch.state === 'ground') {
      if (this.mode === 'combat') {
        const it = ch.item;
        const isGun = it && it.kind === 'weapon';
        ch.ads = isGun && inp.isDown('Mouse2') && ch.reloadT <= 0;
        if (inp.wasPressed('KeyR')) g.combat.reload(ch);
        if (it) {
          const auto = it.kind === 'pickaxe' || (isGun && WEAPONS[it.id].auto);
          const fire = auto ? inp.isDown('Mouse0') : inp.wasPressed('Mouse0');
          if (fire) {
            const aim = this.computeAim();
            g.combat.tryAttack(ch, aim.origin, aim.dir);
          }
        }
      } else {
        ch.ads = false;
        if (inp.wasPressed('Mouse2')) this.cycleMaterial();
      }
    } else {
      ch.ads = false;
    }
    this.updateBuild(dt);

    this.interactTarget = ch.state === 'ground' ? g.items.nearestInteractable(ch) : null;
    if (inp.wasPressed('KeyE') && this.interactTarget) {
      const t = this.interactTarget;
      if (t.type === 'chest') g.items.openChest(t.obj, ch);
      else g.items.pickup(ch, t.obj);
    }
  }

  updateCamera(dt) {
    const g = this.game, ch = this.ch, cam = this.camera;
    let yaw = ch.yaw, pitch = ch.pitch, dist, shoulder, lift = 0.25;
    let targetFov = 75;
    this.scoped = false;
    const spec = g.spectateTarget;
    if (!ch.alive && spec) {
      _pivot.set(spec.pos.x, spec.visualY + 1.5, spec.pos.z);
      if (spec.state === 'bus') _pivot.copy(g.bus.position);
      yaw = this.orbitYaw;
      pitch = this.orbitPitch;
      dist = spec.state === 'bus' ? 26 : 6;
      shoulder = 0;
    } else if (ch.state === 'bus' || (!ch.alive && !spec)) {
      _pivot.copy(g.bus.position);
      if (!ch.alive) _pivot.set(ch.pos.x, ch.pos.y + 1.5, ch.pos.z);
      dist = 26;
      shoulder = 0;
      lift = 3;
    } else if (ch.state === 'freefall' || ch.state === 'glide') {
      _pivot.set(ch.pos.x, ch.visualY + 1.2, ch.pos.z);
      dist = 7.5;
      shoulder = 0;
      lift = 1.2;
    } else {
      _pivot.set(ch.pos.x, ch.visualY + 1.6, ch.pos.z);
      const def = ch.def;
      if (ch.ads && def) {
        targetFov = def.adsFov || 60;
        if (def.scope) this.scoped = this.fov < 40;
      }
      dist = ch.ads ? 2.0 : 3.4;
      shoulder = ch.ads ? 0.7 : 0.78;
      if (this.mode === 'build') dist = 3.8;
    }
    this.fov = damp(this.fov, targetFov, 14, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.camDist = damp(this.camDist, dist, 10, dt);
    this.kick = damp(this.kick, 0, 9, dt);
    this.forward(_dir, yaw, pitch + this.kick);
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    if (this.scoped) {
      _want.set(ch.pos.x, ch.eyeY, ch.pos.z);
    } else {
      _want.copy(_pivot).addScaledVector(_dir, -this.camDist).addScaledVector(_right, shoulder);
      _want.y += lift;
      // Keep the camera out of walls and terrain.
      const o = _tmp.copy(_pivot).addScaledVector(_right, shoulder * 0.5);
      const dx = _want.x - o.x, dy = _want.y - o.y, dz = _want.z - o.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > 0.01) {
        const hit = g.collision.raycast(o.x, o.y, o.z, dx / len, dy / len, dz / len, len + 0.3);
        if (hit) _want.set(o.x + (dx / len) * Math.max(0.2, hit.t - 0.3), o.y + (dy / len) * Math.max(0.2, hit.t - 0.3), o.z + (dz / len) * Math.max(0.2, hit.t - 0.3));
      }
      const tg = g.terrain.height(_want.x, _want.z) + 0.3;
      if (_want.y < tg) _want.y = tg;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.25;
      _want.x += (Math.random() - 0.5) * s;
      _want.y += (Math.random() - 0.5) * s;
      _want.z += (Math.random() - 0.5) * s;
    }
    cam.position.copy(_want);
    cam.lookAt(_tmp.copy(_want).add(_dir));
    this.camPos.copy(_want);
    this.hideSelf = this.scoped || (ch.alive && ch.state === 'ground' && _want.distanceTo(_pivot) < 0.8);
    g.audio.setListener(_want.x, _want.y, _want.z, yaw);
  }
}

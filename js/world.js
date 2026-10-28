import * as THREE from 'three';
import { GRID, LEVEL, POI_NAMES, WORLD } from './config.js';
import { getTextures } from './textures.js';
import { DIRS } from './structures.js';

// Map generation: towns of grid-aligned houses, trees, rocks, metal containers.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _mm = new THREE.Matrix4();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// Instanced, individually destroyable props.
class PropSet {
  constructor(scene, parts, capacity, opts = {}) {
    this.items = [];
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geo, p.mat, capacity);
      m.castShadow = opts.castShadow !== false;
      m.receiveShadow = !!opts.receiveShadow;
      m.count = 0;
      m.userData.local = p.local || new THREE.Matrix4();
      m.userData.colorize = !!p.colorize;
      scene.add(m);
      return m;
    });
    this.capacity = capacity;
  }

  add(data) {
    const idx = this.items.length;
    if (idx >= this.capacity) return null;
    const item = { set: this, idx, alive: true, shake: 0, colliders: [], ...data };
    this.items.push(item);
    for (const m of this.meshes) {
      m.count = idx + 1;
      if (m.userData.colorize && item.color !== undefined) m.setColorAt(idx, _col.setHex(item.color));
    }
    this.write(item, 0, 0);
    return item;
  }

  write(item, ox, oz) {
    _p.set(item.x + ox, item.y, item.z + oz);
    _q.setFromEuler(_e.set(0, item.rotY || 0, 0));
    _s.set(item.sx, item.sy, item.sz);
    _m.compose(_p, _q, _s);
    for (const m of this.meshes) {
      m.setMatrixAt(item.idx, item.alive ? _mm.multiplyMatrices(_m, m.userData.local) : ZERO);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  finalize() {
    for (const m of this.meshes) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }
}

function localMatrix(x, y, z, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
}

const HOUSE_PALETTES = [
  [0xf3e3c3, 0xc0392b], [0xd9e8f5, 0x2c3e50], [0xf7d5a8, 0x6b4226], [0xcde7c8, 0x8e44ad],
  [0xf6f1e7, 0x27ae60], [0xffd7d7, 0x34495e], [0xe8e3ff, 0xd35400], [0xfff3b0, 0x2980b9],
];

export class World {
  constructor(game, rng) {
    this.game = game;
    this.rng = rng;
    this.scene = game.scene;
    this.terrain = game.terrain;
    this.pois = [];
    this.lootSpots = [];   // {x, y, z}
    this.chestSpots = [];  // {x, y, z, rotY}
    this.props = [];
    this.shaking = new Set();
    this.usedCells = new Set();
  }

  // Chooses town sites and registers flattening before the terrain is generated.
  planPOIs() {
    const rng = this.rng, T = this.terrain;
    const names = [...POI_NAMES].sort(() => rng.next() - 0.5);
    const count = 7;
    for (let tries = 0; tries < 600 && this.pois.length < count; tries++) {
      const a = rng.float(0, Math.PI * 2);
      const d = rng.float(30, WORLD.islandRadius * 0.72);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const raw = T.rawHeight(x, z);
      if (raw < 3 || raw > 30) continue;
      if (this.pois.some((p) => Math.hypot(p.x - x, p.z - z) < 95)) continue;
      const r = 42;
      const k0 = Math.max(1, Math.round(raw / LEVEL));
      const poi = { name: names[this.pois.length], x: Math.round(x / GRID) * GRID, z: Math.round(z / GRID) * GRID, r, k0, h: k0 * LEVEL };
      this.pois.push(poi);
      T.addFlat(poi.x, poi.z, r, poi.h);
    }
  }

  build() {
    const tex = getTextures();
    this.buildPropSets(tex);
    this.pois.forEach((poi, idx) => this.buildTown(poi, idx === 0));
    this.scatterProps();
    this.buildSky();
    this.buildWater();
    this.buildClouds();
    for (const s of this.sets) s.finalize();
  }

  buildPropSets(tex) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const pineMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x9b968f, flatShading: true });
    const crateMat = new THREE.MeshLambertMaterial({ map: tex.metal, color: 0xffffff });
    const bushMat = new THREE.MeshLambertMaterial({ color: 0x4f9a3a, flatShading: true });
    const scene = this.scene;
    const trunk = new THREE.CylinderGeometry(0.26, 0.4, 3.2, 6);
    this.pines = new PropSet(scene, [
      { geo: trunk, mat: trunkMat, local: localMatrix(0, 1.6, 0) },
      { geo: new THREE.ConeGeometry(2.1, 3.8, 7), mat: pineMat, local: localMatrix(0, 4.3, 0), colorize: true },
      { geo: new THREE.ConeGeometry(1.5, 3.0, 7), mat: pineMat, local: localMatrix(0, 6.1, 0), colorize: true },
    ], 900);
    this.oaks = new PropSet(scene, [
      { geo: trunk, mat: trunkMat, local: localMatrix(0, 1.6, 0) },
      { geo: new THREE.IcosahedronGeometry(2.5, 1), mat: leafMat, local: localMatrix(0, 4.7, 0, 1, 0.85, 1), colorize: true },
    ], 700);
    this.rocks = new PropSet(scene, [
      { geo: new THREE.IcosahedronGeometry(1, 0), mat: rockMat, local: localMatrix(0, 0, 0) },
    ], 300, { receiveShadow: true });
    this.crates = new PropSet(scene, [
      { geo: new THREE.BoxGeometry(1, 1, 1), mat: crateMat, local: localMatrix(0, 0.5, 0), colorize: true },
    ], 200, { receiveShadow: true });
    this.bushes = new PropSet(scene, [
      { geo: new THREE.IcosahedronGeometry(1, 1), mat: bushMat, local: localMatrix(0, 0.55, 0, 1.25, 0.9, 1.25) },
    ], 500, { castShadow: false });
    this.sets = [this.pines, this.oaks, this.rocks, this.crates, this.bushes];
  }

  addProp(set, data, colliderBoxes) {
    const item = set.add(data);
    if (!item) return null;
    item.isProp = true;
    for (const b of colliderBoxes) {
      const c = { type: 'box', solid: b.solid !== false, bullet: true, owner: item, ...b };
      item.colliders.push(c);
      this.game.collision.add(c);
    }
    this.props.push(item);
    return item;
  }

  addTree(x, z, kind, s) {
    const y = this.terrain.height(x, z) - 0.2;
    const greens = kind === 'pine' ? [0x2f7d3a, 0x3c8f45, 0x2a6e33, 0x4a9c4f] : [0x5cb84a, 0x6dc355, 0x4ea73f, 0x88c94a, 0xe0a030];
    const color = this.rng.pick(greens);
    const set = kind === 'pine' ? this.pines : this.oaks;
    return this.addProp(set, {
      kind: 'tree', mat: 'wood', x, y, z, rotY: this.rng.float(0, 6.28), sx: s, sy: s, sz: s,
      hp: Math.round(200 * s), maxHp: Math.round(200 * s), color,
    }, [
      { minX: x - 0.45 * s, maxX: x + 0.45 * s, minZ: z - 0.45 * s, maxZ: z + 0.45 * s, minY: y, maxY: y + 3.4 * s },
      { minX: x - 1.6 * s, maxX: x + 1.6 * s, minZ: z - 1.6 * s, maxZ: z + 1.6 * s, minY: y + 3.4 * s, maxY: y + 7 * s, solid: false },
    ]);
  }

  addRock(x, z, s) {
    const g = this.terrain.height(x, z);
    const sx = s * this.rng.float(1.6, 2.4), sy = s * this.rng.float(1.1, 1.7), sz = s * this.rng.float(1.5, 2.2);
    const y = g + sy * 0.3;
    return this.addProp(this.rocks, {
      kind: 'rock', mat: 'stone', x, y, z, rotY: this.rng.float(0, 6.28), sx, sy, sz,
      hp: Math.round(300 * s), maxHp: Math.round(300 * s),
    }, [{ minX: x - sx * 0.75, maxX: x + sx * 0.75, minZ: z - sz * 0.75, maxZ: z + sz * 0.75, minY: g - 1, maxY: y + sy * 0.8 }]);
  }

  addCrate(x, z, rotY, long) {
    const y = this.terrain.height(x, z) - 0.05;
    const sx = long ? 2.5 : 1.8, sy = long ? 2.6 : 1.6, sz = long ? 6 : 1.8;
    const color = this.rng.pick([0xd04a3a, 0x3a72d0, 0x4caf50, 0xe6a23c, 0x9aa6b2]);
    const across = Math.abs(Math.sin(rotY)) > 0.5;
    const hx = (across ? sz : sx) / 2, hz = (across ? sx : sz) / 2;
    return this.addProp(this.crates, {
      kind: 'crate', mat: 'metal', x, y, z, rotY, sx, sy, sz, color,
      hp: long ? 500 : 250, maxHp: long ? 500 : 250,
    }, [{ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: y, maxY: y + sy }]);
  }

  addBush(x, z, s) {
    const y = this.terrain.height(x, z) - 0.15;
    return this.bushes.add({ kind: 'bush', x, y, z, rotY: this.rng.float(0, 6.28), sx: s, sy: s, sz: s, alive: true });
  }

  cellFree(i0, j0, w, d) {
    for (let i = i0 - 1; i <= i0 + w; i++) for (let j = j0 - 1; j <= j0 + d; j++) if (this.usedCells.has(`${i},${j}`)) return false;
    return true;
  }

  buildTown(poi, big) {
    const rng = this.rng;
    const ci = Math.round(poi.x / GRID), cj = Math.round(poi.z / GRID);
    const houses = [];
    const isTowers = poi.name === 'Tumble Towers' || big;
    if (isTowers) {
      houses.push({ i0: ci - 1, j0: cj - 1, w: 2, d: 2, stories: rng.int(3, 4), tower: true });
    }
    const target = rng.int(4, 6);
    for (let tries = 0; tries < 80 && houses.length < target + (isTowers ? 1 : 0); tries++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(8, 24);
      const w = rng.int(2, 3), d = rng.int(2, 3);
      const i0 = Math.round((poi.x + Math.cos(a) * r) / GRID) - Math.floor(w / 2);
      const j0 = Math.round((poi.z + Math.sin(a) * r) / GRID) - Math.floor(d / 2);
      const h = { i0, j0, w, d, stories: rng.chance(0.4) ? 2 : 1 };
      if (houses.some((o) => !(i0 + w + 1 <= o.i0 || o.i0 + o.w + 1 <= i0 || j0 + d + 1 <= o.j0 || o.j0 + o.d + 1 <= j0))) continue;
      houses.push(h);
    }
    for (const h of houses) {
      if (!this.cellFree(h.i0, h.j0, h.w, h.d)) continue;
      for (let i = h.i0; i < h.i0 + h.w; i++) for (let j = h.j0; j < h.j0 + h.d; j++) this.usedCells.add(`${i},${j}`);
      this.buildHouse(h, poi.k0);
    }
    // Containers and a few rocks around town edges.
    for (let n = 0; n < 4; n++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(26, 36);
      const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
      if (this.terrain.height(x, z) < 1) continue;
      this.addCrate(x, z, rng.chance(0.5) ? 0 : Math.PI / 2, rng.chance(0.6));
    }
    for (let n = 0; n < 2; n++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(10, 28);
      const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
      if (!this.isFreeOfHouses(x, z, 2)) continue;
      this.chestSpots.push({ x, y: this.terrain.height(x, z), z, rotY: rng.float(0, 6.28) });
    }
  }

  isFreeOfHouses(x, z, margin) {
    const i = Math.floor(x / GRID), j = Math.floor(z / GRID);
    const m = Math.ceil(margin / GRID);
    for (let a = i - m; a <= i + m; a++) for (let b = j - m; b <= j + m; b++) if (this.usedCells.has(`${a},${b}`)) return false;
    return true;
  }

  buildHouse(h, k0) {
    const S = this.game.structures, rng = this.rng;
    const [wallColor, roofColor] = rng.pick(HOUSE_PALETTES);
    const wallVis = S.houseMaterial('wall', wallColor);
    const roofVis = S.houseMaterial('roof', roofColor);
    const floorVis = S.houseMaterial('floor', 0xffffff);
    const material = rng.chance(0.3) ? 'stone' : 'wood';
    const base = { map: true, instant: true };
    const { i0, j0, w, d, stories } = h;
    // Stair cells alternate between the first two cells of the front row.
    const stairCell = (s) => (s % 2 === 0 ? [i0, j0] : [i0 + 1, j0]);
    const floorCells = [];
    for (let s = 0; s < stories; s++) {
      const k = k0 + s;
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < d; b++) {
          const ci = i0 + a, cj = j0 + b;
          if (s > 0) {
            const [si, sj] = stairCell(s - 1);
            if (si === ci && sj === cj) continue;
          }
          S.create('floor', ci, cj, k, 0, 'wood', { ...base, visual: floorVis });
          const [si, sj] = stairCell(s);
          if (!(s < stories - 1 && si === ci && sj === cj)) floorCells.push({ ci, cj, k });
        }
      }
      if (s < stories - 1) {
        const [si, sj] = stairCell(s);
        S.create('ramp', si, sj, k, s % 2 === 0 ? 0 : 2, 'wood', { ...base, visual: floorVis });
      }
      const doorAt = stories > 1 ? rng.int(1, w - 1) : rng.int(0, w - 1);
      const backDoor = rng.int(0, w - 1);
      for (let a = 0; a < w; a++) {
        const front = s === 0 && a === doorAt ? 'door' : rng.chance(0.35) ? 'window' : 'solid';
        const back = s === 0 && a === backDoor && rng.chance(0.5) ? 'door' : rng.chance(0.35) ? 'window' : 'solid';
        S.create('wall', i0 + a, j0, k, 0, material, { ...base, visual: wallVis, variant: front });
        S.create('wall', i0 + a, j0 + d, k, 0, material, { ...base, visual: wallVis, variant: back });
      }
      for (let b = 0; b < d; b++) {
        const v1 = rng.chance(0.35) ? 'window' : 'solid', v2 = rng.chance(0.35) ? 'window' : 'solid';
        S.create('wall', i0, j0 + b, k, 1, material, { ...base, visual: wallVis, variant: v1 });
        S.create('wall', i0 + w, j0 + b, k, 1, material, { ...base, visual: wallVis, variant: v2 });
      }
    }
    const roofK = k0 + stories;
    const cones = !h.tower && rng.chance(0.6);
    for (let a = 0; a < w; a++) {
      for (let b = 0; b < d; b++) {
        S.create(cones ? 'cone' : 'floor', i0 + a, j0 + b, roofK, 0, 'wood', { ...base, visual: roofVis });
      }
    }
    // Loot: one chest per house, floor loot elsewhere.
    const cells = floorCells.sort(() => rng.next() - 0.5);
    if (cells.length) {
      const c = cells.shift();
      const [dx, dz] = rng.pick(DIRS);
      this.chestSpots.push({ x: c.ci * GRID + 2 + dx * 1.2, y: c.k * LEVEL, z: c.cj * GRID + 2 + dz * 1.2, rotY: Math.atan2(dx, dz) });
    }
    const lootCount = Math.min(cells.length, rng.int(1, 3));
    for (let n = 0; n < lootCount; n++) {
      const c = cells[n];
      this.lootSpots.push({ x: c.ci * GRID + 2 + rng.float(-1, 1), y: c.k * LEVEL, z: c.cj * GRID + 2 + rng.float(-1, 1) });
    }
  }

  scatterProps() {
    const rng = this.rng, T = this.terrain;
    const R = WORLD.islandRadius * 0.95;
    const nearTown = (x, z, f) => this.pois.some((p) => Math.hypot(p.x - x, p.z - z) < p.r * f);
    const spaced = new Set();
    const okSpacing = (x, z) => {
      const k = `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
      if (spaced.has(k)) return false;
      spaced.add(k);
      return true;
    };
    let trees = 0;
    for (let tries = 0; tries < 9000 && trees < 620; tries++) {
      const x = rng.float(-R, R), z = rng.float(-R, R);
      if (Math.hypot(x, z) > R) continue;
      const h = T.height(x, z);
      if (h < 1.6 || T.slope(x, z) > 0.9 || h > 42) continue;
      if (nearTown(x, z, 0.8)) continue;
      const density = T.noiseD(x * 0.012 + 40, z * 0.012 - 7);
      if (density < -0.05 && !rng.chance(0.12)) continue;
      if (!okSpacing(x, z)) continue;
      const kind = h > 18 || rng.chance(0.35) ? 'pine' : 'oak';
      this.addTree(x, z, kind, rng.float(0.8, 1.35));
      trees++;
    }
    let rocks = 0;
    for (let tries = 0; tries < 3000 && rocks < 150; tries++) {
      const x = rng.float(-R, R), z = rng.float(-R, R);
      if (Math.hypot(x, z) > R) continue;
      const h = T.height(x, z);
      if (h < 0.5 || nearTown(x, z, 0.75)) continue;
      if (!okSpacing(x, z)) continue;
      this.addRock(x, z, rng.float(0.7, 1.6));
      rocks++;
    }
    let crates = 0;
    for (let tries = 0; tries < 1000 && crates < 30; tries++) {
      const x = rng.float(-R, R), z = rng.float(-R, R);
      if (Math.hypot(x, z) > R || T.height(x, z) < 1.5 || T.slope(x, z) > 0.35 || nearTown(x, z, 0.8)) continue;
      if (!okSpacing(x, z)) continue;
      this.addCrate(x, z, rng.float(0, Math.PI), rng.chance(0.5));
      crates++;
    }
    let bushes = 0;
    for (let tries = 0; tries < 3000 && bushes < 380; tries++) {
      const x = rng.float(-R, R), z = rng.float(-R, R);
      if (Math.hypot(x, z) > R || T.height(x, z) < 1.2 || nearTown(x, z, 0.55)) continue;
      if (!this.isFreeOfHouses(x, z, 2)) continue;
      this.addBush(x, z, rng.float(0.7, 1.3));
      bushes++;
    }
    // Outdoor chests and loot.
    for (let n = 0, tries = 0; n < 14 && tries < 400; tries++) {
      const x = rng.float(-R, R) * 0.9, z = rng.float(-R, R) * 0.9;
      if (Math.hypot(x, z) > R * 0.9 || T.height(x, z) < 1.5 || nearTown(x, z, 1)) continue;
      this.chestSpots.push({ x, y: T.height(x, z), z, rotY: rng.float(0, 6.28) });
      n++;
    }
    for (let n = 0, tries = 0; n < 40 && tries < 800; tries++) {
      const x = rng.float(-R, R) * 0.9, z = rng.float(-R, R) * 0.9;
      if (Math.hypot(x, z) > R * 0.9 || T.height(x, z) < 1.5) continue;
      if (!this.isFreeOfHouses(x, z, 2)) continue;
      this.lootSpots.push({ x, y: T.height(x, z), z });
      n++;
    }
  }

  damageProp(prop, amount) {
    if (!prop.alive) return false;
    prop.hp -= amount;
    prop.shake = 0.18;
    this.shaking.add(prop);
    if (prop.hp <= 0) {
      prop.alive = false;
      this.shaking.delete(prop);
      for (const c of prop.colliders) this.game.collision.remove(c);
      prop.set.write(prop, 0, 0);
      const center = new THREE.Vector3(prop.x, prop.y + (prop.kind === 'tree' ? 3 * prop.sy : prop.sy * 0.5), prop.z);
      const color = prop.kind === 'tree' ? prop.color : prop.kind === 'rock' ? 0x9b968f : prop.color;
      this.game.effects.burst(center, color, 18, 6, 0.35);
      this.game.audio.play('break', center, 0.9);
      return true;
    }
    return false;
  }

  update(dt) {
    for (const p of this.shaking) {
      p.shake -= dt;
      if (p.shake <= 0) {
        this.shaking.delete(p);
        p.set.write(p, 0, 0);
      } else {
        const a = p.shake * 0.6;
        p.set.write(p, Math.sin(p.shake * 90) * a, Math.cos(p.shake * 70) * a);
      }
    }
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f8cff) },
        mid: { value: new THREE.Color(0x8fd0ff) },
        bottom: { value: new THREE.Color(0xd8f0ff) },
      },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vPos;
        void main(){ float h = normalize(vPos).y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bottom, smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b9be0, transparent: true, opacity: 0.82 });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = 0;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  buildClouds() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa4b0, flatShading: true, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const rng = this.rng;
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const n = rng.int(3, 6);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat);
        const s = rng.float(10, 22);
        m.scale.set(s * 1.5, s * 0.6, s);
        m.position.set(rng.float(-25, 25), rng.float(-3, 4), rng.float(-12, 12));
        g.add(m);
      }
      g.position.set(rng.float(-700, 700), rng.float(170, 230), rng.float(-700, 700));
      this.scene.add(g);
    }
  }
}

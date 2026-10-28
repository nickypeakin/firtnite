import * as THREE from 'three';
import { GRID, LEVEL, MATERIALS, BUILD_START_HP } from './config.js';
import { getTextures } from './textures.js';
import { surfaceY } from './collision.js';

// Grid-aligned build pieces (player builds and map houses share this system).
//
// Walls sit on cell edges: dir 0 spans x at z = j*GRID, dir 1 spans z at x = i*GRID.
// Floors, ramps and cones occupy cell (i, j) at level k. Ramp dir d rises along
// the forward vector of yaw d*PI/2.

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

const T = 0.26; // wall thickness
const H = LEVEL;
const WALL_PARTS = {
  solid: [[-2, 0, -T / 2, 2, H, T / 2]],
  door: [[-2, 0, -T / 2, -0.8, H, T / 2], [0.8, 0, -T / 2, 2, H, T / 2], [-0.8, 2.7, -T / 2, 0.8, H, T / 2]],
  window: [[-2, 0, -T / 2, -0.9, H, T / 2], [0.9, 0, -T / 2, 2, H, T / 2], [-0.9, 0, -T / 2, 0.9, 1.2, T / 2], [-0.9, 2.5, -T / 2, 0.9, H, T / 2]],
};
const FLOOR_PART = [-2, -0.2, -2, 2, 0, 2];
export const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];

function planarBoxGeometry(parts) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (const [x0, y0, z0, x1, y1, z1] of parts) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = nor.getX(i), ny = nor.getY(i);
      positions.push(x, y, z);
      normals.push(nx, ny, nor.getZ(i));
      if (Math.abs(ny) > 0.5) uvs.push(x / 4 + 0.5, z / 4 + 0.5);
      else if (Math.abs(nx) > 0.5) uvs.push(z / 4 + 0.5, y / 4);
      else uvs.push(x / 4 + 0.5, y / 4);
    }
    for (let i = 0; i < g.index.count; i++) indices.push(base + g.index.getX(i));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function rampGeometry() {
  const L = GRID * Math.SQRT2;
  const g = new THREE.BoxGeometry(GRID, 0.2, L);
  g.translate(0, -0.1, 0);
  g.rotateX(Math.PI / 4);
  g.translate(0, H / 2, 0);
  return g;
}

function coneGeometry() {
  const g = new THREE.ConeGeometry(2 * Math.SQRT2, 2, 4, 1).toNonIndexed();
  g.rotateY(Math.PI / 4);
  g.translate(0, 1, 0);
  g.computeVertexNormals();
  return g;
}

// Grid slot a build piece goes into, from the builder's feet position and view.
// onRamp: the builder stands on a ramp rising the way they face, so a new ramp
// continues that slope instead of starting at their feet.
export function computeBuildTarget(type, pos, yaw, pitch, onRamp = false) {
  const TAU = Math.PI * 2;
  const yawN = ((yaw % TAU) + TAU) % TAU;
  const di = Math.round(yawN / (Math.PI / 2)) % 4;
  const [fx, fz] = DIRS[di];
  const px = pos.x, pz = pos.z, feet = pos.y;
  const ci = Math.floor(px / GRID), cj = Math.floor(pz / GRID);
  if (type === 'wall') {
    let k = Math.floor((feet + 1.2) / LEVEL);
    if (pitch > 0.55) k++;
    if (fz === -1) return { type, i: ci, j: cj, k, dir: 0 };
    if (fz === 1) return { type, i: ci, j: cj + 1, k, dir: 0 };
    if (fx === -1) return { type, i: ci, j: cj, k, dir: 1 };
    return { type, i: ci + 1, j: cj, k, dir: 1 };
  }
  if (type === 'floor' || type === 'cone') {
    if (pitch > 0.45 || (type === 'cone' && pitch > 0.1)) return { type, i: ci, j: cj, k: Math.floor((feet + 0.5) / LEVEL) + 1, dir: 0 };
    const ahead = pitch > -0.7;
    return { type, i: ci + (ahead ? fx : 0), j: cj + (ahead ? fz : 0), k: Math.floor((feet + 1.0) / LEVEL), dir: 0 };
  }
  const ti = Math.floor((px + fx * 2.5) / GRID), tj = Math.floor((pz + fz * 2.5) / GRID);
  if (onRamp) {
    // Height of the current slope where it reaches the target cell's low edge.
    const cx = ti * GRID + 2, cz = tj * GRID + 2;
    const gap = cx * fx + cz * fz - 2 - (px * fx + pz * fz);
    return { type, i: ti, j: tj, k: Math.round((feet + gap) / LEVEL), dir: di };
  }
  // On flat ground the low edge must be within a step of the feet.
  return { type, i: ti, j: tj, k: Math.floor((feet + 0.65) / LEVEL), dir: di };
}

export function pieceKey(type, i, j, k, dir) {
  if (type === 'wall') return `w${dir}:${i}:${j}:${k}`;
  if (type === 'floor') return `f:${i}:${j}:${k}`;
  return `v:${i}:${j}:${k}`; // ramps and cones share the cell volume
}

// Placement transform + world-space colliders for a hypothetical piece.
export function layout(type, i, j, k, dir, variant = 'solid') {
  const y = k * LEVEL;
  const colliders = [];
  let x, z, rotY = 0;
  if (type === 'wall') {
    if (dir === 0) { x = i * GRID + 2; z = j * GRID; }
    else { x = i * GRID; z = j * GRID + 2; rotY = Math.PI / 2; }
    for (const [x0, y0, z0, x1, y1, z1] of WALL_PARTS[variant]) {
      const c = { type: 'box', minY: y + y0, maxY: y + y1 };
      if (dir === 0) { c.minX = x + x0; c.maxX = x + x1; c.minZ = z + z0; c.maxZ = z + z1; }
      else { c.minX = x + z0; c.maxX = x + z1; c.minZ = z - x1; c.maxZ = z - x0; }
      colliders.push(c);
    }
  } else {
    x = i * GRID + 2;
    z = j * GRID + 2;
    if (type === 'floor') {
      const [x0, y0, z0, x1, y1, z1] = FLOOR_PART;
      colliders.push({ type: 'box', pop: true, minX: x + x0, maxX: x + x1, minY: y + y0, maxY: y + y1, minZ: z + z0, maxZ: z + z1 });
    } else if (type === 'ramp') {
      rotY = dir * (Math.PI / 2);
      const [fx, fz] = DIRS[dir];
      colliders.push({ type: 'ramp', minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, minY: y - 0.3, maxY: y + H, base: y, rise: H, fx, fz });
    } else {
      colliders.push({ type: 'cone', minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, minY: y - 0.3, maxY: y + 2, base: y, peak: 2, cx: x, cz: z, half: 2 });
    }
  }
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const c of colliders) {
    c.solid = true;
    c.bullet = true;
    b.minX = Math.min(b.minX, c.minX); b.maxX = Math.max(b.maxX, c.maxX);
    b.minY = Math.min(b.minY, c.minY); b.maxY = Math.max(b.maxY, c.maxY);
    b.minZ = Math.min(b.minZ, c.minZ); b.maxZ = Math.max(b.maxZ, c.maxZ);
  }
  return { x, y, z, rotY, colliders, bounds: b };
}

export class StructureManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.collision = game.collision;
    this.terrain = game.terrain;
    this.byKey = new Map();
    this.pieces = new Set();
    this.building = new Set();
    this.shaking = new Set();
    this.collapsing = [];
    this.pendingChecks = new Set();
    this._tmp = [];

    const tex = getTextures();
    this.geo = {
      wall: {
        solid: planarBoxGeometry(WALL_PARTS.solid),
        door: planarBoxGeometry(WALL_PARTS.door),
        window: planarBoxGeometry(WALL_PARTS.window),
      },
      floor: planarBoxGeometry([FLOOR_PART]),
      ramp: rampGeometry(),
      cone: coneGeometry(),
    };
    this.mats = {};
    this.buildMats = {};
    for (const m of ['wood', 'stone', 'metal']) {
      this.mats[m] = new THREE.MeshLambertMaterial({ map: tex[m] });
      this.buildMats[m] = new THREE.MeshLambertMaterial({ map: tex[m], transparent: true, opacity: 0.55, emissive: 0x1a3d66 });
    }
    this.houseMatCache = new Map();
    this.batches = new Map();
  }

  // Map pieces are drawn through shared instanced meshes, one per geometry + material.
  batchFor(geometry, material) {
    const k = `${geometry.uuid}|${material.uuid}`;
    let b = this.batches.get(k);
    if (!b || b.count >= b.capacity) {
      const capacity = 256;
      b = new THREE.InstancedMesh(geometry, material, capacity);
      b.capacity = capacity;
      b.count = 0;
      b.castShadow = true;
      b.receiveShadow = true;
      b.frustumCulled = false;
      this.scene.add(b);
      this.batches.set(k, b);
    }
    return b;
  }

  writeInstance(piece, ox = 0, oz = 0) {
    const p = piece.basePos;
    _pos.set(p.x + ox, p.y, p.z + oz);
    _quat.setFromAxisAngle(_up, piece.rotY);
    _mat.compose(_pos, _quat, _one);
    piece.batch.setMatrixAt(piece.index, piece.alive ? _mat : _zero);
    piece.batch.instanceMatrix.needsUpdate = true;
  }

  houseMaterial(kind, color) {
    const k = `${kind}:${color}`;
    let m = this.houseMatCache.get(k);
    if (!m) {
      const tex = getTextures();
      const map = kind === 'wall' ? tex.siding : kind === 'roof' ? tex.shingle : tex.floor;
      m = new THREE.MeshLambertMaterial({ map, color });
      this.houseMatCache.set(k, m);
    }
    return m;
  }

  geometryFor(type, variant = 'solid') {
    return type === 'wall' ? this.geo.wall[variant] : this.geo[type];
  }

  // True when standing on a ramp that rises in the facing direction.
  onRampFacing(pos, yaw) {
    const TAU = Math.PI * 2;
    const di = Math.round((((yaw % TAU) + TAU) % TAU) / (Math.PI / 2)) % 4;
    const cols = this.collision.query(pos.x - 0.1, pos.z - 0.1, pos.x + 0.1, pos.z + 0.1, this._tmp);
    for (const c of cols) {
      if (c.type !== 'ramp' || c.fx !== DIRS[di][0] || c.fz !== DIRS[di][1]) continue;
      if (Math.abs(surfaceY(c, pos.x, pos.z) - pos.y) < 0.6) return true;
    }
    return false;
  }

  isOccupied(type, i, j, k, dir) {
    return this.byKey.has(pieceKey(type, i, j, k, dir));
  }

  // Valid when free, not fully buried and touching the ground or another piece.
  canPlace(type, i, j, k, dir) {
    if (this.isOccupied(type, i, j, k, dir)) return false;
    const L = layout(type, i, j, k, dir);
    const b = L.bounds;
    const top = type === 'floor' ? b.maxY : b.maxY - 0.4;
    if (top < this.terrain.height((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) - 0.1) return false;
    if (this.boundsGrounded(type, b, L.y)) return true;
    const e = 0.12;
    const cols = this.collision.queryBox(b.minX - e, b.minY - e, b.minZ - e, b.maxX + e, b.maxY + e, b.maxZ + e, this._tmp);
    for (const c of cols) if (c.owner && c.owner.isPiece && c.owner.alive) return true;
    return false;
  }

  boundsGrounded(type, b, baseY) {
    const T = this.terrain;
    const pts = [];
    if (type === 'wall') {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const alongX = b.maxX - b.minX > b.maxZ - b.minZ;
      for (const o of [-1.8, 0, 1.8]) pts.push(alongX ? [cx + o, cz] : [cx, cz + o]);
    } else {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      pts.push([cx, cz]);
      for (const sx of [-1.7, 1.7]) for (const sz of [-1.7, 1.7]) pts.push([cx + sx, cz + sz]);
    }
    const floorY = type === 'floor' ? baseY - 0.2 : baseY;
    for (const [x, z] of pts) if (T.height(x, z) >= floorY - 0.3) return true;
    return false;
  }

  // opts: { owner, map, variant, instant, visual (material), hp }
  create(type, i, j, k, dir, material, opts = {}) {
    const key = pieceKey(type, i, j, k, dir);
    if (this.byKey.has(key)) return null;
    const variant = opts.variant || 'solid';
    const L = layout(type, i, j, k, dir, variant);
    const def = MATERIALS[material];
    const piece = {
      isPiece: true, type, i, j, k, dir, material, key, variant,
      owner: opts.owner || null,
      map: !!opts.map,
      alive: true,
      maxHp: opts.hp || def.hp,
      hp: 0,
      buildLeft: 0,
      buildRate: 0,
      shake: 0,
      colliders: L.colliders,
      bounds: L.bounds,
      visual: opts.visual || null,
    };
    if (opts.instant) {
      piece.hp = piece.maxHp;
    } else {
      piece.hp = piece.maxHp * BUILD_START_HP;
      piece.buildLeft = def.buildTime;
      piece.buildRate = (piece.maxHp * (1 - BUILD_START_HP)) / def.buildTime;
      this.building.add(piece);
    }
    const mat = piece.visual || (opts.instant ? this.mats[material] : this.buildMats[material]);
    const geo = this.geometryFor(type, variant);
    piece.basePos = new THREE.Vector3(L.x, L.y, L.z);
    piece.rotY = L.rotY;
    if (opts.instant) {
      piece.batch = this.batchFor(geo, mat);
      piece.index = piece.batch.count++;
      this.writeInstance(piece);
    } else {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(piece.basePos);
      mesh.rotation.y = L.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      piece.mesh = mesh;
      this.scene.add(mesh);
    }
    for (const c of piece.colliders) {
      c.owner = piece;
      this.collision.add(c);
    }
    piece.grounded = this.boundsGrounded(type, piece.bounds, L.y);
    this.byKey.set(key, piece);
    this.pieces.add(piece);
    return piece;
  }

  damage(piece, amount) {
    if (!piece.alive) return;
    piece.hp -= amount;
    piece.shake = 0.14;
    this.shaking.add(piece);
    if (piece.hp <= 0) this.destroy(piece);
  }

  destroy(piece, checkNeighbors = true) {
    if (!piece.alive) return;
    piece.alive = false;
    this.byKey.delete(piece.key);
    this.pieces.delete(piece);
    this.building.delete(piece);
    this.shaking.delete(piece);
    for (const c of piece.colliders) this.collision.remove(c);
    if (piece.batch) this.writeInstance(piece);
    else this.scene.remove(piece.mesh);
    const b = piece.bounds;
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const color = piece.visual ? piece.visual.color.getHex() : piece.material === 'wood' ? 0xa87040 : piece.material === 'stone' ? 0x9a9a9a : 0x9aa6b2;
    this.game.effects.debris(center, color, b);
    this.game.audio.play('break', center, 0.8);
    if (checkNeighbors) {
      for (const n of this.neighbors(piece)) this.pendingChecks.add(n);
    }
  }

  neighbors(piece) {
    const b = piece.bounds, e = 0.12;
    const cols = this.collision.queryBox(b.minX - e, b.minY - e, b.minZ - e, b.maxX + e, b.maxY + e, b.maxZ + e, this._tmp);
    const out = new Set();
    for (const c of cols) {
      const o = c.owner;
      if (o && o.isPiece && o !== piece && o.alive) out.add(o);
    }
    return out;
  }

  checkSupport(start) {
    const seen = new Set([start]);
    const stack = [start];
    const comp = [];
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      if (p.grounded || comp.length > 300) return null;
      for (const n of this.neighbors(p)) {
        if (!seen.has(n) && !n.collapsing) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return comp;
  }

  update(dt) {
    for (const p of this.building) {
      p.buildLeft -= dt;
      p.hp = Math.min(p.maxHp, p.hp + p.buildRate * dt);
      if (p.buildLeft <= 0) {
        this.building.delete(p);
        if (!p.visual) p.mesh.material = this.mats[p.material];
      }
    }
    for (const p of this.shaking) {
      p.shake -= dt;
      const done = p.shake <= 0;
      if (done) this.shaking.delete(p);
      const ox = done ? 0 : (Math.random() - 0.5) * 0.12, oz = done ? 0 : (Math.random() - 0.5) * 0.12;
      if (p.batch) {
        this.writeInstance(p, ox, oz);
      } else {
        p.mesh.position.set(p.basePos.x + ox, p.basePos.y, p.basePos.z + oz);
        p.mesh.updateMatrix();
      }
    }
    if (this.pendingChecks.size) {
      const seeds = [...this.pendingChecks];
      this.pendingChecks.clear();
      for (const s of seeds) {
        if (!s.alive || s.collapsing) continue;
        const comp = this.checkSupport(s);
        if (comp) {
          comp.forEach((p, idx) => {
            p.collapsing = true;
            this.collapsing.push({ piece: p, t: 0.05 + idx * 0.035 });
          });
        }
      }
    }
    for (let i = this.collapsing.length - 1; i >= 0; i--) {
      const c = this.collapsing[i];
      c.t -= dt;
      if (c.t <= 0) {
        this.destroy(c.piece, false);
        this.collapsing.splice(i, 1);
      }
    }
  }
}

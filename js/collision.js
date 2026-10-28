import { PHYS, WORLD, GRID } from './config.js';
import { clamp } from './util.js';

// Spatial hash of colliders plus character movement and ray casting.
//
// Collider shapes:
//   box:  axis-aligned box
//   ramp: 45 degree slab over one grid cell, rising along (fx, fz)
//   cone: four-sided pyramid roof over one grid cell
// Every collider has an AABB (minX..maxZ), `owner`, `solid` (blocks movement)
// and `bullet` (blocks shots).

const CELL = 8;
const SLAB = 0.3;          // thickness of ramp / cone surfaces
const FLOOR_POP = 1.2;     // floors spawned around the body push the character up
const SURF_POP = 1.6;
const key = (ix, iz) => (ix + 512) * 1024 + (iz + 512);

export function surfaceY(c, x, z) {
  if (c.type === 'ramp') {
    const cx = (c.minX + c.maxX) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
    const t = clamp(((x - cx) * c.fx + (z - cz) * c.fz) / GRID + 0.5, 0, 1);
    return c.base + t * c.rise;
  }
  const d = Math.max(Math.abs(x - c.cx), Math.abs(z - c.cz)) / c.half;
  return c.base + c.peak * (1 - clamp(d, 0, 1));
}

const _iv = [0, 0];
// Writes [tmin, tmax] into out and returns true when the ray overlaps the box.
function rayBoxInterval(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, out) {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < minX || ox > maxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv, t2 = (maxX - ox) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < minY || oy > maxY) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv, t2 = (maxY - oy) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < minZ || oz > maxZ) return false;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv, t2 = (maxZ - oz) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (tmin > tmax || tmax < 0) return false;
  out[0] = tmin;
  out[1] = tmax;
  return true;
}

// Entry distance, or -1 for a miss or when the ray starts inside.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  if (!rayBoxInterval(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ, _iv)) return -1;
  return _iv[0] >= 0 ? _iv[0] : -1;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

function raySurface(c, ox, oy, oz, dx, dy, dz) {
  if (!rayBoxInterval(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ, _iv)) return -1;
  const t0 = Math.max(0, _iv[0]), t1 = _iv[1];
  const N = 10;
  let prevT = t0;
  let prev = oy + dy * t0 - surfaceY(c, ox + dx * t0, oz + dz * t0);
  for (let i = 1; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const g = oy + dy * t - surfaceY(c, ox + dx * t, oz + dz * t);
    if ((prev > 0) !== (g > 0) || Math.abs(g) < SLAB * 0.5) {
      let a = prevT, b = t, ga = prev;
      for (let k = 0; k < 6; k++) {
        const m = (a + b) * 0.5;
        const gm = oy + dy * m - surfaceY(c, ox + dx * m, oz + dz * m);
        if ((ga > 0) === (gm > 0)) { a = m; ga = gm; } else b = m;
      }
      return (a + b) * 0.5;
    }
    prev = g;
    prevT = t;
  }
  return -1;
}

export function rayCollider(c, ox, oy, oz, dx, dy, dz) {
  if (c.type === 'box') return rayBox(ox, oy, oz, dx, dy, dz, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
  return raySurface(c, ox, oy, oz, dx, dy, dz);
}

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.grid = new Map();
    this.stamp = 1;
    this._cols = [];
  }

  add(c) {
    c.cells = [];
    c.q = 0;
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c);
        c.cells.push(arr);
      }
    }
    return c;
  }

  remove(c) {
    if (!c.cells) return;
    for (const arr of c.cells) {
      const i = arr.indexOf(c);
      if (i >= 0) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
    c.cells = null;
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c.q === s) continue;
          c.q = s;
          if (c.maxX >= minX && c.minX <= maxX && c.maxZ >= minZ && c.minZ <= maxZ) out.push(c);
        }
      }
    }
    return out;
  }

  // Colliders whose AABB overlaps the given box (all axes).
  queryBox(minX, minY, minZ, maxX, maxY, maxZ, out = []) {
    this.query(minX, minZ, maxX, maxZ, out);
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (c.maxY >= minY && c.minY <= maxY) out[w++] = c;
    }
    out.length = w;
    return out;
  }

  // Highest walkable surface at (x, z) at or below fromY.
  groundAt(x, z, fromY = 1e9) {
    let g = Math.max(this.terrain.height(x, z), WORLD.waterFloor);
    const cols = this.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, this._cols);
    for (const c of cols) {
      if (!c.solid) continue;
      let top;
      if (c.type === 'box') {
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        top = c.maxY;
      } else {
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        top = surfaceY(c, x, z);
      }
      if (top <= fromY + 0.05 && top > g) g = top;
    }
    return g;
  }

  moveCharacter(ch, dt) {
    const dist = Math.hypot(ch.vel.x, ch.vel.z) * dt + Math.abs(ch.vel.y) * dt * 0.3;
    const steps = Math.min(8, Math.max(1, Math.ceil(dist / 0.3)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) this._step(ch, sdt);
  }

  _surfOverlap(c, x, z, feet, h) {
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) return false;
    const s = surfaceY(c, x, z);
    return s > feet + PHYS.stepHeight && s - SLAB < feet + h;
  }

  _surfBlocked(cols, ox, oz, x, z, feet, h) {
    for (const c of cols) {
      if (!c.solid || c.type === 'box') continue;
      if (this._surfOverlap(c, x, z, feet, h) && !this._surfOverlap(c, ox, oz, feet, h)) return true;
    }
    return false;
  }

  _step(ch, dt) {
    const p = ch.pos, v = ch.vel, r = ch.radius, h = ch.height;
    const STEP = PHYS.stepHeight;
    const ox = p.x, oz = p.z, feet = p.y;
    let nx = ox + v.x * dt, nz = oz + v.z * dt;
    const cols = this.query(Math.min(ox, nx) - r - 0.2, Math.min(oz, nz) - r - 0.2,
      Math.max(ox, nx) + r + 0.2, Math.max(oz, nz) + r + 0.2, this._cols);

    // Push the body circle out of boxes it overlaps vertically.
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.solid || c.type !== 'box') continue;
        const stepLimit = c.pop ? FLOOR_POP : STEP;
        if (c.maxY <= feet + stepLimit || c.minY >= feet + h) continue;
        const cx = clamp(nx, c.minX, c.maxX), cz = clamp(nz, c.minZ, c.maxZ);
        const dx = nx - cx, dz = nz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const k = (r - d) / d;
          nx += dx * k;
          nz += dz * k;
        } else {
          const pl = nx - c.minX, pr = c.maxX - nx, pb = nz - c.minZ, pf = c.maxZ - nz;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) nx = c.minX - r;
          else if (m === pr) nx = c.maxX + r;
          else if (m === pb) nz = c.minZ - r;
          else nz = c.maxZ + r;
        }
      }
    }

    if (this._surfBlocked(cols, ox, oz, nx, nz, feet, h)) {
      if (!this._surfBlocked(cols, ox, oz, nx, oz, feet, h)) nz = oz;
      else if (!this._surfBlocked(cols, ox, oz, ox, nz, feet, h)) nx = ox;
      else { nx = ox; nz = oz; }
    }

    const bd = Math.hypot(nx, nz);
    if (bd > WORLD.boundary) {
      nx *= WORLD.boundary / bd;
      nz *= WORLD.boundary / bd;
    }
    p.x = nx;
    p.z = nz;

    // Vertical.
    const wasGrounded = ch.grounded;
    if (!ch.noGravity) v.y -= PHYS.gravity * dt;
    const vyBefore = v.y;
    let ny = feet + v.y * dt;
    let ground = Math.max(this.terrain.height(nx, nz), WORLD.waterFloor);
    const fr = r * 0.75;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c.solid) continue;
      if (c.type === 'box') {
        if (c.maxY > feet + (c.pop ? FLOOR_POP : STEP) + 0.001) continue;
        if (nx + fr < c.minX || nx - fr > c.maxX || nz + fr < c.minZ || nz - fr > c.maxZ) continue;
        if (c.maxY > ground) ground = c.maxY;
      } else {
        if (nx < c.minX || nx > c.maxX || nz < c.minZ || nz > c.maxZ) continue;
        const s = surfaceY(c, nx, nz);
        if (s <= feet + SURF_POP && s > ground) ground = s;
      }
    }

    if (v.y > 0) {
      const headOld = feet + h, headNew = ny + h;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.solid) continue;
        let bottom;
        if (c.type === 'box') {
          if (nx + fr < c.minX || nx - fr > c.maxX || nz + fr < c.minZ || nz - fr > c.maxZ) continue;
          bottom = c.minY;
        } else {
          if (nx < c.minX || nx > c.maxX || nz < c.minZ || nz > c.maxZ) continue;
          bottom = surfaceY(c, nx, nz) - SLAB;
        }
        if (bottom >= headOld - 0.05 && bottom < headNew) {
          ny = bottom - h;
          v.y = 0;
        }
      }
    }

    if (ny <= ground) {
      ny = ground;
      if (v.y < 0) v.y = 0;
      ch.grounded = true;
    } else if (wasGrounded && v.y <= 0 && ny - ground < 0.5) {
      ny = ground;
      v.y = 0;
      ch.grounded = true;
    } else {
      ch.grounded = false;
    }
    p.y = ny;
    if (!wasGrounded && ch.grounded && ch.onLand) ch.onLand(-vyBefore);
  }

  rayTerrain(ox, oy, oz, dx, dy, dz, maxT) {
    const T = this.terrain;
    const top = T.maxHeight + 0.5;
    let t = 0;
    let g = oy - T.height(ox, oz);
    if (g < 0) return 0;
    while (t < maxT) {
      const y = oy + dy * t;
      if (dy >= 0 && y > top) return -1;
      const step = Math.max(0.5, g * 0.6);
      const nt = Math.min(maxT, t + step);
      const ng = oy + dy * nt - T.height(ox + dx * nt, oz + dz * nt);
      if (ng < 0) {
        let a = t, b = nt;
        for (let k = 0; k < 8; k++) {
          const m = (a + b) * 0.5;
          if (oy + dy * m - T.height(ox + dx * m, oz + dz * m) < 0) b = m;
          else a = m;
        }
        return (a + b) * 0.5;
      }
      if (nt >= maxT) break;
      t = nt;
      g = ng;
    }
    return -1;
  }

  // opts: { characters, ignoreChar, ignoreOwner, terrain (default true), structures (default true) }
  raycast(ox, oy, oz, dx, dy, dz, maxDist, opts = {}) {
    let bestT = maxDist, best = null, bestChar = null, bestHead = false, bestTerrain = false;
    if (opts.structures !== false) {
      const s = ++this.stamp;
      let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
      const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const adx = Math.abs(dx), adz = Math.abs(dz);
      const tDeltaX = adx > 1e-9 ? CELL / adx : Infinity;
      const tDeltaZ = adz > 1e-9 ? CELL / adz : Infinity;
      let tMaxX = adx > 1e-9 ? (dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / adx : Infinity;
      let tMaxZ = adz > 1e-9 ? (dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / adz : Infinity;
      let tCell = 0;
      for (let guard = 0; guard < 400 && tCell <= bestT; guard++) {
        const arr = this.grid.get(key(ix, iz));
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (c.q === s) continue;
            c.q = s;
            if (!c.bullet || (opts.ignoreOwner && c.owner === opts.ignoreOwner)) continue;
            const t = rayCollider(c, ox, oy, oz, dx, dy, dz);
            if (t >= 0 && t < bestT) {
              bestT = t;
              best = c;
            }
          }
        }
        if (tMaxX < tMaxZ) { tCell = tMaxX; tMaxX += tDeltaX; ix += stepX; }
        else { tCell = tMaxZ; tMaxZ += tDeltaZ; iz += stepZ; }
        if (tCell > maxDist || Math.abs(ix) > 60 || Math.abs(iz) > 60) break;
      }
    }
    if (opts.terrain !== false) {
      const t = this.rayTerrain(ox, oy, oz, dx, dy, dz, bestT);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = null;
        bestTerrain = true;
      }
    }
    if (opts.characters) {
      for (const ch of opts.characters) {
        if (!ch.alive || !ch.hittable || ch === opts.ignoreChar) continue;
        const cx = ch.pos.x, cy = ch.pos.y + 0.95, cz = ch.pos.z;
        const wx = cx - ox, wy = cy - oy, wz = cz - oz;
        const tc = wx * dx + wy * dy + wz * dz;
        if (tc < -1.5 || tc > bestT + 1.5) continue;
        const px = wx - dx * tc, py = wy - dy * tc, pz = wz - dz * tc;
        if (px * px + py * py + pz * pz > 2.25) continue;
        const th = raySphere(ox, oy, oz, dx, dy, dz, cx, ch.pos.y + 1.68, cz, 0.27);
        const tb = rayBox(ox, oy, oz, dx, dy, dz, cx - 0.36, ch.pos.y, cz - 0.36, cx + 0.36, ch.pos.y + 1.44, cz + 0.36);
        let t = -1, head = false;
        if (th >= 0 && (tb < 0 || th <= tb)) { t = th; head = true; }
        else if (tb >= 0) t = tb;
        if (t >= 0 && t < bestT) {
          bestT = t;
          bestChar = ch;
          bestHead = head;
          best = null;
          bestTerrain = false;
        }
      }
    }
    if (!best && !bestChar && !bestTerrain) return null;
    return {
      t: bestT,
      x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT,
      collider: best,
      character: bestChar,
      head: bestHead,
      terrain: bestTerrain,
    };
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05);
  }
}

import * as THREE from 'three';
import { WORLD } from './config.js';
import { createNoise2D, fbm, smoothstep, lerp } from './util.js';

const _c = new THREE.Color();

export class Terrain {
  constructor(rng) {
    this.size = WORLD.size;
    this.half = this.size / 2;
    this.cell = WORLD.cell;
    this.n = Math.round(this.size / this.cell) + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.noiseA = createNoise2D(rng.next);
    this.noiseB = createNoise2D(rng.next);
    this.noiseC = createNoise2D(rng.next);
    this.noiseD = createNoise2D(rng.next);
    this.flats = [];
    this.maxHeight = 0;
  }

  // Height before town flattening.
  rawHeight(x, z) {
    const d = Math.hypot(x, z) / WORLD.islandRadius + this.noiseC(x * 0.007, z * 0.007) * 0.22;
    const land = 1 - smoothstep(0.8, 1.0, d);
    const hills = fbm(this.noiseA, x * 0.0055, z * 0.0055, 4) * 0.5 + 0.5;
    let h = 2.5 + hills * hills * 30;
    const ridge = 1 - Math.abs(fbm(this.noiseB, x * 0.004 + 5, z * 0.004 - 3, 3)) * 1.6;
    h += Math.pow(smoothstep(0.55, 1.0, ridge), 2) * 26 * smoothstep(0.25, 0.6, hills);
    return lerp(-7, h, land);
  }

  addFlat(x, z, r, h) {
    this.flats.push({ x, z, r, h });
  }

  generate() {
    const { n, cell, half } = this;
    let maxH = 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -half + ix * cell, z = -half + iz * cell;
        let h = this.rawHeight(x, z);
        for (const f of this.flats) {
          const d = Math.hypot(x - f.x, z - f.z);
          if (d < f.r) h = lerp(h, f.h, 1 - smoothstep(f.r * 0.62, f.r, d));
        }
        this.heights[iz * n + ix] = h;
        if (h > maxH) maxH = h;
      }
    }
    this.maxHeight = maxH;
  }

  // Matches the triangle split used by the render mesh exactly.
  height(x, z) {
    const fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const n = this.n;
    if (ix < 0 || iz < 0 || ix >= n - 1 || iz >= n - 1) return -7;
    const tx = fx - ix, tz = fz - iz;
    const H = this.heights;
    const i = iz * n + ix;
    const h00 = H[i], h10 = H[i + 1], h01 = H[i + n], h11 = H[i + n + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  slope(x, z) {
    const e = 1.5;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  inTown(x, z) {
    for (const f of this.flats) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.7) return true;
    return false;
  }

  colorAt(x, z, h, slope, out) {
    const v = this.noiseD(x * 0.05, z * 0.05);
    if (h < 0.9) {
      out.setHex(h < -1 ? 0xc9b77f : 0xeadba4);
    } else {
      let town = 0;
      for (const f of this.flats) {
        const d = Math.hypot(x - f.x, z - f.z);
        town = Math.max(town, 1 - smoothstep(f.r * 0.45, f.r * 0.6, d));
      }
      out.setHex(0x63b84a).lerp(_c.setHex(0x3f8f37), v * 0.5 + 0.5);
      if (h < 1.8) out.lerp(_c.setHex(0xd9cf96), 1 - (h - 0.9) / 0.9);
      if (town > 0) out.lerp(_c.setHex(0xc8b285), town * 0.85);
      const rock = Math.max(smoothstep(0.75, 1.1, slope), smoothstep(34, 40, h));
      if (rock > 0) out.lerp(_c.setHex(0x8f8b84), rock);
      if (h > 44) out.lerp(_c.setHex(0xf2f5f8), smoothstep(44, 48, h));
    }
    return out;
  }

  buildMesh() {
    const { n, cell, half } = this;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = -half + ix * cell, z = -half + iz * cell, h = this.heights[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        this.colorAt(x, z, h, this.slope(x, z), _c);
        col[i * 3] = _c.r;
        col[i * 3 + 1] = _c.g;
        col[i * 3 + 2] = _c.b;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < n - 1; iz++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = iz * n + ix, b = a + 1, c = a + n, d = a + n + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Top-down color image for the minimap.
  buildMapImage(px = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(px, px);
    const c = new THREE.Color();
    const deep = new THREE.Color(0.08, 0.26, 0.52);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const wx = (x / px) * this.size - this.half, wz = (y / px) * this.size - this.half;
        const h = this.height(wx, wz);
        if (h < 0) {
          c.setRGB(0.16, 0.5, 0.78).lerp(deep, Math.min(1, -h / 7));
        } else {
          this.colorAt(wx, wz, h, this.slope(wx, wz), c);
          const shade = (this.height(wx - 2, wz - 2) - h) * 0.06;
          c.offsetHSL(0, 0, Math.max(-0.15, Math.min(0.15, shade)));
        }
        c.convertLinearToSRGB();
        const i = (y * px + x) * 4;
        img.data[i] = c.r * 255;
        img.data[i + 1] = c.g * 255;
        img.data[i + 2] = c.b * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

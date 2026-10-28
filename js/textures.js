import * as THREE from 'three';

// Small procedural canvas textures so the game ships without image assets.

function makeCanvas(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, size, count, alpha, light = false) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

export function woodTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#b77b43';
  ctx.fillRect(0, 0, s, s);
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const y = (i * s) / planks;
    ctx.fillStyle = i % 2 ? '#a96f3a' : '#bf8549';
    ctx.fillRect(0, y + 2, s, s / planks - 4);
    for (let g = 0; g < 10; g++) {
      ctx.strokeStyle = 'rgba(80,45,15,0.25)';
      ctx.beginPath();
      const gy = y + 4 + Math.random() * (s / planks - 8);
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(s * 0.3, gy + 3, s * 0.6, gy - 3, s, gy + 1);
      ctx.stroke();
    }
    ctx.fillStyle = '#6d4220';
    ctx.fillRect(0, y, s, 3);
    ctx.fillStyle = '#4a2c14';
    ctx.fillRect(6, y + 10, 4, 4);
    ctx.fillRect(s - 10, y + 10, 4, 4);
  }
  speckle(ctx, s, 300, 0.15);
  ctx.strokeStyle = '#5a3518';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, s - 4, s - 4);
  return toTexture(c);
}

export function stoneTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6a68';
  ctx.fillRect(0, 0, s, s);
  const rows = 5, bh = s / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bh : 0;
    for (let x = -off; x < s; x += bh * 2) {
      const g = 140 + Math.random() * 40;
      ctx.fillStyle = `rgb(${g},${g - 2},${g - 6})`;
      ctx.fillRect(x + 2, r * bh + 2, bh * 2 - 4, bh - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 2, r * bh + 2, bh * 2 - 4, 3);
    }
  }
  speckle(ctx, s, 500, 0.2);
  return toTexture(c);
}

export function metalTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, '#9aa6b2');
  grad.addColorStop(1, '#7c8894');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 4; i++) {
    const x = (i * s) / 4;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, 0, 2, s);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x + 2, 0, 2, s);
  }
  ctx.fillStyle = '#c9d2db';
  for (let i = 0; i < 4; i++) {
    for (const y of [8, s - 10]) {
      ctx.beginPath();
      ctx.arc((i * s) / 4 + 16, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(40,50,60,0.5)';
  ctx.fillRect(0, s / 2 - 6, s, 12);
  speckle(ctx, s, 200, 0.12, true);
  return toTexture(c);
}

export function sidingTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, s, s);
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    const y = (i * s) / rows;
    const g = ctx.createLinearGradient(0, y, 0, y + s / rows);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, s, s / rows);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y + s / rows - 2, s, 2);
  }
  speckle(ctx, s, 150, 0.08);
  return toTexture(c);
}

export function shingleTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, s, s);
  const rows = 8, w = 16;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? w / 2 : 0;
    for (let x = -off; x < s; x += w) {
      const g = 190 + Math.random() * 50;
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x + 1, r * (s / rows) + 1, w - 2, s / rows - 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, (r + 1) * (s / rows) - 2, s, 2);
  }
  return toTexture(c);
}

export function floorTexture() {
  const s = 128, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = '#c9a77c';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? '#bf9c70' : '#d1b087';
    ctx.fillRect((i * s) / 8 + 1, 0, s / 8 - 2, s);
  }
  speckle(ctx, s, 300, 0.12);
  return toTexture(c);
}

export function glowTexture() {
  const s = 64, c = makeCanvas(s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blueprintTexture() {
  const s = 64, c = makeCanvas(s), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(90,170,255,0.35)';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(200,235,255,0.95)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(200,235,255,0.5)';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * s) / 4, 0);
    ctx.lineTo((i * s) / 4, s);
    ctx.moveTo(0, (i * s) / 4);
    ctx.lineTo(s, (i * s) / 4);
    ctx.stroke();
  }
  return toTexture(c);
}

let cache = null;
export function getTextures() {
  if (!cache) {
    cache = {
      wood: woodTexture(),
      stone: stoneTexture(),
      metal: metalTexture(),
      siding: sidingTexture(),
      shingle: shingleTexture(),
      floor: floorTexture(),
      glow: glowTexture(),
      blueprint: blueprintTexture(),
    };
  }
  return cache;
}

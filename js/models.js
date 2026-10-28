import * as THREE from 'three';
import { RARITIES, CONSUMABLES, AMMO } from './config.js';

// Low-poly models assembled from primitives. Rigid groups of parts are merged
// into one vertex-colored mesh each to keep draw calls low.

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const box = (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, seg = 8) => cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sphere = (r, w = 12, h = 10) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));

const matCache = new Map();
export function lambert(color, extra = {}) {
  const k = `${color}|${JSON.stringify(extra)}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshLambertMaterial({ color, ...extra })));
  return m;
}
export const VCOLOR = new THREE.MeshLambertMaterial({ vertexColors: true });

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

// Collects primitives, then bakes them into a single geometry with vertex colors.
class Merge {
  constructor() {
    this.parts = [];
  }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.parts.push({ geo, color, x, y, z, rx, ry, rz });
    return this;
  }
  geometry() {
    const pos = [], nor = [], col = [];
    for (const p of this.parts) {
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)), ONE);
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      g.applyMatrix4(_m);
      _c.setHex(p.color);
      const pa = g.attributes.position, na = g.attributes.normal;
      for (let i = 0; i < pa.count; i++) {
        pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
        nor.push(na.getX(i), na.getY(i), na.getZ(i));
        col.push(_c.r, _c.g, _c.b);
      }
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  mesh(shadow = true) {
    const m = new THREE.Mesh(this.geometry(), VCOLOR);
    m.castShadow = shadow;
    return m;
  }
}

const SKIN_TONES = [0xf1c9a5, 0xe0ac7e, 0xc68a5a, 0x8d5a3b, 0x5c3a24, 0xffd9b8];
const OUTFITS = [
  [0xff7b2e, 0x2d3e8c], [0x3fbf6f, 0x2b2b2b], [0xe24b5a, 0x22335c], [0x9b59ff, 0x1f1f2e],
  [0x30a8ff, 0xf2f2f2], [0xffd23f, 0x5a3e2b], [0x2ee6c9, 0x3a2f6b], [0xff5fb0, 0x262b45],
  [0x6b7f3a, 0x3d4a24], [0xf2f2f2, 0xc0392b], [0x1e1e1e, 0xe67e22], [0x8e6bff, 0xffc93c],
];
const HAIR = [0x2b1a0e, 0x5a3418, 0xe0b04a, 0xd44a2a, 0x111111, 0x3b6cff, 0xff6ad5, 0xeeeeee];

export function randomSkin(rng) {
  const outfit = rng.pick(OUTFITS);
  return {
    shirt: outfit[0],
    pants: outfit[1],
    skin: rng.pick(SKIN_TONES),
    hair: rng.pick(HAIR),
    pack: rng.pick([0x444444, 0x7a4b2a, 0x2f6b3a, 0x2a4f8a, 0x8a2a2a]),
    helmet: rng.chance(0.25),
  };
}

export const PLAYER_SKIN = { shirt: 0xff8a1f, pants: 0x283a7a, skin: 0xf1c9a5, hair: 0x3a2412, pack: 0x2a4f8a, helmet: false };

let _gliderGeo = null;
function gliderGeometry() {
  if (_gliderGeo) return _gliderGeo;
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0.3, -1.2, -2.2, 0, 0.6, 0, 0, 0.5,
    0, 0.3, -1.2, 0, 0, 0.5, 2.2, 0, 0.6,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return (_gliderGeo = g);
}

const DARK = 0x1b1b1f;

export function createCharacterModel(skin) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mkLeg = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.92, 0);
    pivot.add(new Merge().add(box(0.24, 0.8, 0.28), skin.pants, 0, -0.42, 0).add(box(0.26, 0.14, 0.36), DARK, 0, -0.85, -0.04).mesh());
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-0.15), legR = mkLeg(0.15);

  body.add(new Merge()
    .add(box(0.6, 0.62, 0.34), skin.shirt, 0, 1.22, 0)
    .add(box(0.62, 0.08, 0.36), DARK, 0, 0.94, 0)
    .add(box(0.42, 0.46, 0.18), skin.pack, 0, 1.24, 0.25)
    .mesh());

  const head = new THREE.Group();
  head.position.set(0, 1.72, 0);
  body.add(head);
  const hm = new Merge().add(box(0.4, 0.4, 0.4), skin.skin);
  if (skin.helmet) {
    hm.add(box(0.46, 0.24, 0.46), skin.pants, 0, 0.12, 0.01).add(box(0.46, 0.1, 0.12), 0x222222, 0, 0.02, -0.2);
  } else {
    hm.add(box(0.43, 0.14, 0.43), skin.hair, 0, 0.2, 0.01).add(box(0.43, 0.3, 0.1), skin.hair, 0, 0.06, 0.18);
  }
  hm.add(box(0.07, 0.08, 0.02), DARK, -0.09, 0.02, -0.205).add(box(0.07, 0.08, 0.02), DARK, 0.09, 0.02, -0.205);
  head.add(hm.mesh());

  const mkArm = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.48, 0);
    pivot.add(new Merge().add(box(0.17, 0.58, 0.2), skin.shirt, 0, -0.27, 0).add(box(0.16, 0.14, 0.18), skin.skin, 0, -0.62, 0).mesh());
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-0.39), armR = mkArm(0.39);

  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(0.24, 1.32, -0.2);
  body.add(weaponHolder);

  const glider = new THREE.Group();
  const gm = new THREE.Mesh(gliderGeometry(), lambert(skin.shirt, { side: THREE.DoubleSide }));
  gm.castShadow = true;
  glider.add(gm);
  glider.add(new Merge()
    .add(cyl(0.02, 0.02, 1.0, 4), DARK, -0.4, -0.5, 0.2, 0, 0, -0.45)
    .add(cyl(0.02, 0.02, 1.0, 4), DARK, 0.4, -0.5, 0.2, 0, 0, 0.45)
    .mesh());
  glider.position.set(0, 2.6, 0);
  glider.visible = false;
  root.add(glider);
  return { root, body, legL, legR, armL, armR, head, weaponHolder, glider };
}

// ---------------------------------------------------------------- weapons

const HALF_PI = Math.PI / 2;

export function createWeaponModel(id, rarity = 0) {
  const g = new THREE.Group();
  const dark = 0x2a2e35, mid = 0x4a515c, wood = 0x8a5a32;
  const accent = new THREE.Color(RARITIES[rarity].color).getHex();
  const m = new Merge();
  const muzzle = new THREE.Object3D();
  switch (id) {
    case 'ar':
      m.add(box(0.08, 0.13, 0.66), dark, 0, 0, -0.12)
        .add(box(0.085, 0.035, 0.36), accent, 0, 0.06, -0.15)
        .add(cyl(0.022, 0.022, 0.3, 6), mid, 0, 0.01, -0.58, HALF_PI)
        .add(box(0.06, 0.2, 0.1), mid, 0, -0.14, -0.12, 0.25)
        .add(box(0.07, 0.13, 0.24), dark, 0, -0.02, 0.32)
        .add(box(0.05, 0.14, 0.06), dark, 0, -0.12, 0.08)
        .add(box(0.03, 0.05, 0.12), mid, 0, 0.1, -0.05);
      muzzle.position.set(0, 0.01, -0.75);
      break;
    case 'smg':
      m.add(box(0.08, 0.12, 0.42), dark, 0, 0, -0.06)
        .add(box(0.085, 0.035, 0.22), accent, 0, 0.055, -0.08)
        .add(cyl(0.022, 0.022, 0.16, 6), mid, 0, 0.01, -0.34, HALF_PI)
        .add(box(0.05, 0.26, 0.07), mid, 0, -0.17, -0.1)
        .add(box(0.05, 0.14, 0.06), dark, 0, -0.1, 0.1);
      muzzle.position.set(0, 0.01, -0.43);
      break;
    case 'shotgun':
      m.add(box(0.08, 0.1, 0.6), dark, 0, 0.02, -0.18)
        .add(cyl(0.03, 0.03, 0.4, 6), mid, 0, 0.04, -0.62, HALF_PI)
        .add(box(0.1, 0.08, 0.22), wood, 0, -0.04, -0.4)
        .add(box(0.07, 0.14, 0.28), wood, 0, -0.03, 0.26)
        .add(box(0.085, 0.03, 0.2), accent, 0, 0.075, -0.1);
      muzzle.position.set(0, 0.04, -0.83);
      break;
    case 'sniper':
      m.add(box(0.07, 0.1, 0.8), dark, 0, 0, -0.1)
        .add(cyl(0.02, 0.02, 0.5, 6), mid, 0, 0.01, -0.74, HALF_PI)
        .add(cyl(0.045, 0.045, 0.34, 8), mid, 0, 0.1, -0.12, HALF_PI)
        .add(box(0.075, 0.03, 0.4), accent, 0, 0.055, 0.0)
        .add(box(0.07, 0.15, 0.26), wood, 0, -0.03, 0.4)
        .add(box(0.05, 0.12, 0.05), dark, 0, -0.1, 0.12);
      muzzle.position.set(0, 0.01, -1.0);
      break;
    case 'pistol':
      m.add(box(0.06, 0.08, 0.26), dark, 0, 0.02, -0.08)
        .add(box(0.065, 0.025, 0.2), accent, 0, 0.065, -0.08)
        .add(box(0.055, 0.15, 0.07), mid, 0, -0.08, 0.02, -0.2);
      muzzle.position.set(0, 0.02, -0.22);
      break;
    case 'rocket':
      m.add(cyl(0.1, 0.1, 1.1, 10), 0x4d5b3a, 0, 0.06, -0.1, HALF_PI)
        .add(cyl(0.12, 0.12, 0.08, 10), accent, 0, 0.06, -0.62, HALF_PI)
        .add(cyl(0.12, 0.12, 0.08, 10), accent, 0, 0.06, 0.42, HALF_PI)
        .add(box(0.05, 0.16, 0.07), dark, 0, -0.1, -0.1)
        .add(box(0.04, 0.08, 0.1), mid, 0.1, 0.16, -0.2);
      muzzle.position.set(0, 0.06, -0.68);
      break;
    case 'pickaxe':
      m.add(cyl(0.03, 0.03, 0.9, 6), wood, 0, 0, -0.3, HALF_PI)
        .add(box(0.06, 0.6, 0.08), 0x8fa3c4, 0, 0, -0.74, 0.1)
        .add(box(0.07, 0.12, 0.1), 0x3d7cff, 0, 0, -0.74);
      muzzle.position.set(0, 0, -0.8);
      break;
  }
  g.add(m.mesh());
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

export function createConsumableModel(id) {
  const g = new THREE.Group();
  const c = new THREE.Color(CONSUMABLES[id].color).getHex();
  const m = new Merge();
  switch (id) {
    case 'bandage':
      m.add(cyl(0.12, 0.12, 0.16, 10), c, 0, 0, 0, 0, 0, HALF_PI).add(cyl(0.05, 0.05, 0.17, 8), 0xc9b99a, 0, 0, 0, 0, 0, HALF_PI);
      break;
    case 'medkit':
      m.add(box(0.46, 0.3, 0.2), c).add(box(0.24, 0.06, 0.21), 0xffffff).add(box(0.06, 0.2, 0.21), 0xffffff);
      break;
    case 'minishield':
      m.add(cyl(0.09, 0.09, 0.22, 10), c).add(cyl(0.04, 0.04, 0.08, 8), 0xdddddd, 0, 0.15, 0);
      break;
    case 'shieldpot':
      m.add(sphere(0.17), c).add(cyl(0.05, 0.05, 0.16, 8), c, 0, 0.2, 0).add(cyl(0.06, 0.06, 0.05, 8), 0xdddddd, 0, 0.3, 0);
      break;
  }
  g.add(m.mesh());
  return g;
}

export function createAmmoModel(id) {
  const g = new THREE.Group();
  const c = new THREE.Color(AMMO[id].color).getHex();
  g.add(new Merge().add(box(0.36, 0.2, 0.24), 0x3a4a2a).add(box(0.37, 0.06, 0.25), c, 0, 0.04, 0).mesh());
  return g;
}

const MAT_COLORS = { wood: [0xb77b43, 0x8a5a32], stone: [0xa5a5a5, 0x7d7d7d], metal: [0xa9b6c4, 0x7c8894] };
export function createMatsModel(id) {
  const g = new THREE.Group();
  const [a, b] = MAT_COLORS[id];
  g.add(new Merge().add(box(0.4, 0.14, 0.4), a).add(box(0.3, 0.14, 0.3), b, 0.04, 0.14, -0.02, 0, 0.4, 0).mesh());
  return g;
}

// ---------------------------------------------------------------- props

export function createChestModel() {
  const g = new THREE.Group();
  const gold = 0xe0aa2c, trim = 0x5a3a12;
  const base = new Merge()
    .add(box(1.1, 0.55, 0.65), gold, 0, 0.275, 0)
    .add(box(1.14, 0.08, 0.69), trim, 0, 0.05, 0)
    .add(box(1.14, 0.08, 0.69), trim, 0, 0.52, 0)
    .mesh();
  base.material = lambert(0xffffff, { vertexColors: true, emissive: 0x3a2600 });
  g.add(base);
  const lid = new THREE.Group();
  lid.position.set(0, 0.55, 0.325);
  const lm = new Merge().add(box(1.12, 0.22, 0.67), gold, 0, 0.11, -0.335).add(box(0.18, 0.18, 0.06), 0xffe9a0, 0, 0.0, -0.68).mesh();
  lm.material = base.material;
  lid.add(lm);
  g.add(lid);
  g.userData.lid = lid;
  return g;
}

export function createBusModel() {
  const g = new THREE.Group();
  const blue = 0x2f7de1, white = 0xf5f5f5, dark = 0x1d2733;
  const bus = new Merge()
    .add(box(3.2, 2.6, 8), blue)
    .add(box(3.25, 0.4, 8.05), white, 0, -0.5, 0)
    .add(box(3.3, 0.9, 6.6), dark, 0, 0.55, -0.2)
    .add(box(2.8, 0.9, 0.1), dark, 0, 0.55, -4.02)
    .add(box(2.9, 0.4, 0.2), 0xffd23f, 0, -0.9, -4.05);
  for (const x of [-1.5, 1.5]) for (const z of [-2.7, 2.7]) bus.add(cyl(0.55, 0.55, 0.35, 12), dark, x, -1.35, z, 0, 0, HALF_PI);
  for (const x of [-1.4, 1.4]) for (const z of [-3.5, 3.5]) bus.add(cyl(0.05, 0.05, 6, 4), dark, x * 0.8, 4.2, z * 0.6, z > 0 ? -0.3 : 0.3);
  g.add(bus.mesh());
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), lambert(0x4aa3ff));
  balloon.position.y = 9.5;
  balloon.scale.set(1, 1.15, 1);
  g.add(balloon);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(5.05, 16, 12, (i * Math.PI) / 3, 0.25), lambert(0xf5f5f5));
    s.position.y = 9.5;
    s.scale.set(1, 1.15, 1);
    g.add(s);
  }
  return g;
}

// Item models wrapped with a rarity beam for floor loot.
export function createPickupVisual(item) {
  const g = new THREE.Group();
  let model, rarity = 0;
  if (item.kind === 'weapon') {
    model = createWeaponModel(item.id, item.rarity);
    rarity = item.rarity;
    model.rotation.y = Math.PI / 2;
  } else if (item.kind === 'consumable') {
    model = createConsumableModel(item.id);
    rarity = CONSUMABLES[item.id].rarity;
  } else if (item.kind === 'ammo') {
    model = createAmmoModel(item.id);
  } else {
    model = createMatsModel(item.id);
  }
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.userData.disposable = 'geometry';
    }
  });
  const spin = new THREE.Group();
  spin.add(model);
  spin.position.y = 0.5;
  g.add(spin);
  g.userData.spin = spin;
  if (item.kind === 'weapon' || item.kind === 'consumable') {
    const color = new THREE.Color(RARITIES[rarity].color);
    const beam = new THREE.Mesh(beamGeometry(), beamMaterial(rarity, color));
    beam.position.y = 1.3;
    g.add(beam);
    const ring = new THREE.Mesh(ringGeometry(), ringMaterial(rarity, color));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
  }
  return g;
}

const beamGeometry = () => cached('beam', () => new THREE.CylinderGeometry(0.06, 0.28, 2.6, 8, 1, true));
const ringGeometry = () => cached('ring', () => new THREE.RingGeometry(0.35, 0.5, 20));
const fxMats = new Map();
function beamMaterial(rarity, color) {
  const k = `beam${rarity}`;
  if (!fxMats.has(k)) fxMats.set(k, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  return fxMats.get(k);
}
function ringMaterial(rarity, color) {
  const k = `ring${rarity}`;
  if (!fxMats.has(k)) fxMats.set(k, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
  return fxMats.get(k);
}

// Game-wide tuning values. Distances are meters, times are seconds.

export const WORLD = {
  size: 640,          // terrain extent
  cell: 2.5,          // terrain grid resolution
  islandRadius: 270,
  boundary: 300,      // characters can't leave this radius
  waterFloor: -1.3,   // characters wade at this depth instead of sinking
};

export const GRID = 4;   // build grid cell size
export const LEVEL = 4;  // build grid level height

export const PHYS = {
  gravity: 26,
  jumpVel: 9,
  walkSpeed: 6.8,
  sprintSpeed: 9.2,
  adsSpeed: 4.2,
  useSpeed: 3,
  stepHeight: 0.65,
  radius: 0.4,
  height: 1.9,
  eye: 1.62,
  freefallSpeed: 26,
  freefallH: 14,
  gliderSpeed: 7,
  gliderH: 15,
  gliderDeployHeight: 45,
  fallDamageSpeed: 19,
};

export const MATERIALS = {
  wood: { name: 'Wood', hp: 150, buildTime: 2.0 },
  stone: { name: 'Stone', hp: 300, buildTime: 3.5 },
  metal: { name: 'Metal', hp: 500, buildTime: 5.5 },
};
export const MAT_ORDER = ['wood', 'stone', 'metal'];
export const BUILD_COST = 10;
export const MAX_MATS = 999;
export const BUILD_START_HP = 0.12; // fraction of max hp a fresh piece starts with

export const RARITIES = [
  { name: 'Common', color: '#b8bec6' },
  { name: 'Uncommon', color: '#62d34b' },
  { name: 'Rare', color: '#3fa6ff' },
  { name: 'Epic', color: '#c35bff' },
  { name: 'Legendary', color: '#ffae34' },
];

// dmg / reload are indexed by rarity.
export const WEAPONS = {
  pickaxe: {
    name: 'Pickaxe', kind: 'melee', dmg: 20, structDmg: 50, rate: 1.7, range: 2.9,
  },
  ar: {
    name: 'Assault Rifle', kind: 'gun', type: 'ar', ammo: 'medium', auto: true,
    dmg: [30, 31, 33, 35, 36], rate: 5.5, mag: 30, reload: [2.6, 2.5, 2.4, 2.3, 2.2],
    spread: 0.032, adsSpread: 0.007, bloom: 0.011, maxBloom: 0.06, headMult: 1.5,
    range: 260, falloffStart: 60, falloffEnd: 200, falloffMin: 0.7, adsFov: 52, sound: 'ar',
  },
  smg: {
    name: 'SMG', kind: 'gun', type: 'smg', ammo: 'light', auto: true,
    dmg: [16, 17, 18, 19, 20], rate: 11, mag: 30, reload: [2.2, 2.1, 2.0, 1.9, 1.8],
    spread: 0.045, adsSpread: 0.03, bloom: 0.005, maxBloom: 0.08, headMult: 1.5,
    range: 150, falloffStart: 20, falloffEnd: 70, falloffMin: 0.6, adsFov: 60, sound: 'smg',
  },
  shotgun: {
    name: 'Pump Shotgun', kind: 'gun', type: 'shotgun', ammo: 'shells', auto: false,
    dmg: [9, 9.5, 10, 10.5, 11], pellets: 10, rate: 0.75, mag: 5, reload: [4.6, 4.4, 4.2, 4.0, 3.8],
    spread: 0.085, adsSpread: 0.07, bloom: 0, maxBloom: 0, headMult: 1.8,
    range: 60, falloffStart: 6, falloffEnd: 26, falloffMin: 0.2, adsFov: 62, sound: 'shotgun',
  },
  sniper: {
    name: 'Bolt Sniper', kind: 'gun', type: 'sniper', ammo: 'heavy', auto: false,
    dmg: [100, 105, 110, 116, 122], rate: 0.4, mag: 1, reload: [2.9, 2.8, 2.7, 2.6, 2.5],
    spread: 0.12, adsSpread: 0.0, bloom: 0, maxBloom: 0, headMult: 2.5,
    range: 520, falloffStart: 400, falloffEnd: 520, falloffMin: 0.9, adsFov: 18, scope: true, sound: 'sniper',
  },
  pistol: {
    name: 'Pistol', kind: 'gun', type: 'pistol', ammo: 'light', auto: false,
    dmg: [23, 24, 25, 26, 28], rate: 6.5, mag: 16, reload: [1.5, 1.45, 1.4, 1.35, 1.3],
    spread: 0.03, adsSpread: 0.01, bloom: 0.012, maxBloom: 0.05, headMult: 2,
    range: 150, falloffStart: 30, falloffEnd: 90, falloffMin: 0.65, adsFov: 58, sound: 'pistol',
  },
  rocket: {
    name: 'Rocket Launcher', kind: 'gun', type: 'rocket', ammo: 'rockets', auto: false,
    dmg: [70, 75, 80, 85, 90], rate: 0.8, mag: 1, reload: [3.4, 3.3, 3.2, 3.1, 3.0],
    spread: 0.01, adsSpread: 0.003, bloom: 0, maxBloom: 0, headMult: 1,
    projectile: true, speed: 60, splash: 5.5, structDmg: 400, range: 300, adsFov: 55, sound: 'rocket',
  },
};

export const CONSUMABLES = {
  bandage: { name: 'Bandages', time: 3.5, heal: 15, cap: 75, stack: 15, give: 5, rarity: 0, color: '#e8e1d0' },
  medkit: { name: 'Med Kit', time: 8, heal: 100, cap: 100, stack: 3, give: 1, rarity: 1, color: '#f04848' },
  minishield: { name: 'Small Shield', time: 2, shield: 25, cap: 50, stack: 6, give: 3, rarity: 1, color: '#55c8ff' },
  shieldpot: { name: 'Shield Potion', time: 5, shield: 50, cap: 100, stack: 3, give: 1, rarity: 2, color: '#2f7dff' },
};

export const AMMO = {
  light: { name: 'Light Ammo', give: 36, color: '#8fd3ff' },
  medium: { name: 'Medium Ammo', give: 30, color: '#7ce07c' },
  heavy: { name: 'Heavy Ammo', give: 6, color: '#ff8a5c' },
  shells: { name: 'Shells', give: 10, color: '#ffd84a' },
  rockets: { name: 'Rockets', give: 3, color: '#ff5c5c' },
};
export const AMMO_ORDER = ['light', 'medium', 'heavy', 'shells', 'rockets'];

export const LOOT = {
  weapons: [['ar', 30], ['smg', 18], ['shotgun', 26], ['pistol', 14], ['sniper', 8], ['rocket', 4]],
  floorRarity: [46, 30, 16, 6, 2],
  chestRarity: [16, 34, 30, 14, 6],
  consumables: [['bandage', 35], ['medkit', 15], ['minishield', 32], ['shieldpot', 18]],
};

// Each phase: wait with the next circle visible, then shrink to it.
export const STORM = {
  startRadius: 430,
  phases: [
    { wait: 75, shrink: 50, radius: 190, dmg: 1 },
    { wait: 50, shrink: 40, radius: 115, dmg: 2 },
    { wait: 40, shrink: 35, radius: 65, dmg: 4 },
    { wait: 30, shrink: 30, radius: 32, dmg: 7 },
    { wait: 25, shrink: 25, radius: 12, dmg: 10 },
    { wait: 20, shrink: 30, radius: 0, dmg: 14 },
  ],
};

export const BUS = { altitude: 130, speed: 30, halfLength: 330 };

export const POI_NAMES = [
  'Maple Meadows', 'Rusty Ridge', 'Sandy Shallows', 'Tumble Towers', 'Mossy Mill',
  'Breezy Bluffs', 'Pickle Plaza', 'Cobble Corners', 'Lonely Lumber',
];

export const BOT_NAMES = [
  'CrankKing', 'NoScopeNed', 'BushCamper', 'DefaultDan', 'TacoTuesday', 'xX_Sweaty_Xx',
  'Rampage99', 'LlamaLover', 'StormChaser', 'PumpPapi', 'BoxFighter', 'ShieldPotSam',
  'NinjaNoodle', 'Lootgoblin', 'TurboBuilder', 'HighGround', 'MedkitMolly', 'Snipey',
  'ChugJugJr', 'Wallsy', 'PeelyFan', 'Fishstick42', 'GlideGuru', 'BananaBread',
  'RockyRoad', 'TiltedTom', 'ZoneWarrior', 'CobaltCrab', 'PixelPete', 'VictoryVic',
  'Cranky', 'BuildBot', 'FloorIsLava', 'OneShotOtto', 'SpicyNacho', 'PotatoAim',
  'WiggleWalls', 'RotateRita', 'TreeHugger', 'Scrappy', 'LaserLarry', 'HotDrop',
  'JellyJam', 'MetalMike', 'StoneCold', 'WoodChuck', 'SqueakyClean', 'Bloopy',
  'Kaboom', 'Sneaky', 'ThirdParty', 'LastCircle',
];

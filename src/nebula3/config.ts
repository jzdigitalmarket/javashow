export const TOUCH_DEVICE = window.matchMedia('(any-pointer: coarse)').matches;

export const CONFIG = {
  pixelRatio: Math.min(window.devicePixelRatio || 1, TOUCH_DEVICE ? 1 : 1.5),
  stars: TOUCH_DEVICE ? 2500 : 6000,
  asteroids: TOUCH_DEVICE ? 18 : 28,
  particles: TOUCH_DEVICE ? 700 : 1800,
  sectorSize: 1600,
  sectorRadiusXZ: 1,
  asteroidsPerSector: TOUCH_DEVICE ? 3 : 5,
  maxBombs: 2,
  fuelDrainCruise: .20,
  fuelDrainBoost: .75,
  fuelDrainWarp: 2.2,
  drones: 9,
  allies: 3,
  bossHp: 42,
  mothershipHp: 180,
  cruiseSpeed: 48,
  boostSpeed: 145,
  warpSpeed: 620
} as const;

import type { Random } from './random'

// Gallery's splatter (spec, "Painted background and splatter"): violet #6d3fd6 listed three
// times so `pick` lands on it most often, then three greys and an ochre. No red. This settles
// the Glass-era question of whether violet was duplicated: it is, three times. The reference's
// other palettes ("purple", "orange") are settings the spec does not build.
export const PALETTES = {
  gallery: ['#6d3fd6', '#6d3fd6', '#6d3fd6', '#1c1c1c', '#454545', '#9a9a9a', '#e9a21f'],
} as const

export type Circle = { x: number; y: number; r: number }

// A tapered streak from (x, y) along `angle` for `length`, with a blob of
// radius `tipR` at the end. `drip` is a downward drip hanging from the tip,
// 0 for none. A drip is drawn no wider than the tip blob (see `radius` below).
export type Ray = {
  x: number
  y: number
  angle: number
  length: number
  width: number
  tipR: number
  drip: number
}

export type Splat = {
  color: string
  // Bounding radius around the splat origin. The painter sizes an offscreen
  // canvas of 2 * radius square from it, so it is computed from the actual
  // geometry plus a single pixel, which keeps the outermost blob's antialiased
  // edge off the canvas border instead of tangent to it.
  radius: number
  core: Circle[]
  rays: Ray[]
  droplets: Circle[]
  drips: Ray[]
  rotation: number
  life: number
  driftX: number
  driftY: number
}

export type Speck = { x: number; y: number; r: number; color: string; phase: number }

// Coordinates are splat-local: origin at the centre, y pointing down (canvas).
const DOWN = Math.PI / 2
const TAU = Math.PI * 2
const BASE_CORE_RADIUS = 11
const DRIP_PROBABILITY = 0.35

export function makeSplat(random: Random, color: string, scale: number): Splat {
  const coreR = BASE_CORE_RADIUS * scale

  // Core: nine overlapping circles. Offsets stay under half a core radius so
  // they merge into one mass.
  const core: Circle[] = []
  for (let i = 0; i < 9; i += 1) {
    const angle = random.range(0, TAU)
    const dist = random.range(0, coreR * 0.45)
    core.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      r: coreR * random.range(0.55, 1),
    })
  }

  // Rays: tapered streaks over the full circle, a blob at the end, and a
  // downward drip on about 35% of them.
  const rays: Ray[] = []
  const rayCount = random.int(10, 23)
  for (let i = 0; i < rayCount; i += 1) {
    const angle = random.range(0, TAU)
    const start = coreR * 0.5
    rays.push({
      x: Math.cos(angle) * start,
      y: Math.sin(angle) * start,
      angle,
      length: coreR * random.range(1.5, 5),
      width: scale * random.range(1.5, 4),
      tipR: scale * random.range(1, 2.5),
      drip: random.next() < DRIP_PROBABILITY ? coreR * random.range(0.4, 1.4) : 0,
    })
  }

  // Droplets: scattered out to roughly five core radii, getting both smaller and
  // further out along the list. Most are tiny: the spray reads as spray, not as a
  // second ring of blobs.
  const droplets: Circle[] = []
  const dropletCount = random.int(40, 90)
  for (let i = 0; i < dropletCount; i += 1) {
    const t = dropletCount > 1 ? i / (dropletCount - 1) : 0
    const angle = random.range(0, TAU)
    const dist = coreR * (1 + t * 4 + random.range(0, 0.2))
    droplets.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      r: scale * (2.5 - 2.1 * t) * random.range(0.85, 1),
    })
  }

  // Drips: vertical, straight down from the core.
  const drips: Ray[] = []
  const dripCount = random.int(0, 3)
  for (let i = 0; i < dripCount; i += 1) {
    const width = scale * random.range(1, 2.5)
    drips.push({
      x: coreR * random.range(-0.6, 0.6),
      y: coreR * random.range(0.2, 0.6),
      angle: DOWN,
      length: coreR * random.range(0.8, 2.2),
      width,
      tipR: width * 0.8,
      drip: 0,
    })
  }

  // Bounding radius: the furthest point of anything that gets painted, plus 1px
  // so a blob tangent to the bound is not cut by its own antialiasing. Rotation
  // about the origin preserves distance, so it does not enter into this.
  let radius = 0
  const reach = (x: number, y: number, extra: number) => {
    radius = Math.max(radius, Math.hypot(x, y) + extra)
  }
  for (const c of core) reach(c.x, c.y, c.r)
  for (const d of droplets) reach(d.x, d.y, d.r)
  for (const ray of [...rays, ...drips]) {
    const tipX = ray.x + Math.cos(ray.angle) * ray.length
    const tipY = ray.y + Math.sin(ray.angle) * ray.length
    reach(tipX, tipY, ray.tipR)
    // A drip hangs straight down from the tip and is no wider than the blob.
    if (ray.drip > 0) reach(tipX, tipY + ray.drip, ray.tipR)
  }

  return {
    color,
    radius: Math.ceil(radius) + 1,
    core,
    rays,
    droplets,
    drips,
    rotation: random.range(-0.25, 0.25),
    life: random.range(16_000, 32_000),
    driftX: random.range(-3, 3),
    driftY: random.range(-3, 3),
  }
}

export function splatCount(width: number, height: number): number {
  return 10 + Math.round((8 * Math.sqrt(width * height)) / 1100)
}

/** Largest speck half-side. Also the margin the exclusion zone needs below it. */
const SPECK_MAX_R = 1.8

export function makeSpecks(
  random: Random,
  width: number,
  height: number,
  palette: readonly string[],
  count = 320,
  /**
   * Keep every speck below this line. Used for the nav exclusion zone; see
   * NAV_EXCLUSION_PX in PaintSplatter.
   */
  minY = 0,
): Speck[] {
  // A speck is drawn as a square centred on (x, y), so its top edge is one
  // half-side above y. The band therefore starts a full half-side below the line.
  //
  // Drawn uniformly over what is left rather than clamped into it: clamping would
  // put a line of specks along the boundary, which reads as a seam.
  const top = Math.min(minY + SPECK_MAX_R, height)

  const specks: Speck[] = []
  for (let i = 0; i < count; i += 1) {
    specks.push({
      x: random.range(0, width),
      y: random.range(top, height),
      r: random.range(0.6, SPECK_MAX_R),
      color: random.pick(palette),
      phase: random.range(0, TAU),
    })
  }
  return specks
}

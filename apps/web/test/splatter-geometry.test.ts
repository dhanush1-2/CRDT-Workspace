import { describe, it, expect } from 'vitest'
import { createRandom } from '@/lib/splatter/random'
import { makeSplat, makeSpecks, splatCount, PALETTES } from '@/lib/splatter/geometry'

describe('splat geometry', () => {
  it("the palette is Gallery's: violet three times, three greys and an ochre, no red", () => {
    expect(PALETTES.gallery).toEqual([
      '#6d3fd6', '#6d3fd6', '#6d3fd6', '#1c1c1c', '#454545', '#9a9a9a', '#e9a21f',
    ])
    expect(Object.keys(PALETTES)).toEqual(['gallery'])
  })

  it('a splat has 9 core circles, 10-23 rays, 40-90 droplets and 0-3 drips', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const splat = makeSplat(createRandom(seed), '#7b3fe4', 1)
      expect(splat.core).toHaveLength(9)
      expect(splat.rays.length).toBeGreaterThanOrEqual(10)
      expect(splat.rays.length).toBeLessThanOrEqual(23)
      expect(splat.droplets.length).toBeGreaterThanOrEqual(40)
      expect(splat.droplets.length).toBeLessThanOrEqual(90)
      expect(splat.drips.length).toBeGreaterThanOrEqual(0)
      expect(splat.drips.length).toBeLessThanOrEqual(3)
    }
  })

  it('about 35% of rays carry a drip', () => {
    let rays = 0
    let dripped = 0
    for (let seed = 0; seed < 200; seed += 1) {
      for (const ray of makeSplat(createRandom(seed), '#7b3fe4', 1).rays) {
        rays += 1
        if (ray.drip > 0) dripped += 1
      }
    }
    // Wide band: this pins "a minority of rays, not none and not all", which is
    // what a regression would break, without asserting the PRNG's exact stream.
    expect(dripped / rays).toBeGreaterThan(0.25)
    expect(dripped / rays).toBeLessThan(0.45)
  })

  it('life is 16-32s, rotation within +/-0.25 rad and drift within +/-3px', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const splat = makeSplat(createRandom(seed), '#7b3fe4', 1)
      expect(splat.life).toBeGreaterThanOrEqual(16_000)
      expect(splat.life).toBeLessThanOrEqual(32_000)
      expect(Math.abs(splat.rotation)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(splat.driftX)).toBeLessThanOrEqual(3)
      expect(Math.abs(splat.driftY)).toBeLessThanOrEqual(3)
    }
  })

  it('splatCount follows 10 + 8 * sqrt(W*H)/1100', () => {
    // Expectations computed by hand, not copied from a run: the point of this test
    // is to pin the formula independently of the implementation.
    // 1100x1100: sqrt = 1100, 8 * 1100 / 1100 = 8, 10 + 8 = 18.
    expect(splatCount(1100, 1100)).toBe(18)
    // 3840x2160: sqrt = 2880, 8 * 2880 / 1100 = 20.945 -> 21, 10 + 21 = 31. A 4K
    // viewport separates this formula from the old one, which gave 47 there.
    expect(splatCount(3840, 2160)).toBe(31)
    expect(splatCount(1440, 900)).toBe(10 + Math.round((8 * Math.sqrt(1440 * 900)) / 1100))
  })

  it('specks default to about 320 and sit inside the viewport', () => {
    const specks = makeSpecks(createRandom(3), 800, 600, PALETTES.gallery)
    expect(specks).toHaveLength(320)
    for (const speck of specks) {
      expect(speck.x).toBeGreaterThanOrEqual(0)
      expect(speck.x).toBeLessThanOrEqual(800)
      expect(speck.y).toBeGreaterThanOrEqual(0)
      expect(speck.y).toBeLessThanOrEqual(600)
    }
  })

  it('specks stay clear of an exclusion zone, half-side included', () => {
    const minY = 90
    const specks = makeSpecks(createRandom(5), 800, 600, PALETTES.gallery, 320, minY)
    for (const speck of specks) {
      // The top edge, not the centre: a speck is a square centred on (x, y), so a
      // centre exactly on the line would still paint above it.
      expect(speck.y - speck.r).toBeGreaterThanOrEqual(minY)
      expect(speck.y).toBeLessThanOrEqual(600)
    }
  })

  it('specks are spread through the allowed band, not piled on its edge', () => {
    // The other half of the test above: clamping y into the band would satisfy it
    // while putting every speck on the boundary.
    const minY = 300
    const specks = makeSpecks(createRandom(5), 800, 600, PALETTES.gallery, 320, minY)
    const onEdge = specks.filter((speck) => speck.y < minY + 10).length
    expect(onEdge).toBeLessThan(60)
  })

  it('droplets get smaller down the list', () => {
    const { droplets } = makeSplat(createRandom(11), '#7b3fe4', 1)
    // "40-90 scattered at decreasing size" — assert the trend, not every step.
    const firstTen = droplets.slice(0, 10).reduce((sum, d) => sum + d.r, 0) / 10
    const lastTen = droplets.slice(-10).reduce((sum, d) => sum + d.r, 0) / 10
    expect(firstTen).toBeGreaterThan(lastTen)
  })

  it('radius is the bounding radius of the geometry plus a 1px edge margin, not more', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const splat = makeSplat(createRandom(seed), '#7b3fe4', 1)
      let furthest = 0
      for (const c of [...splat.core, ...splat.droplets]) {
        furthest = Math.max(furthest, Math.hypot(c.x, c.y) + c.r)
      }
      for (const ray of [...splat.rays, ...splat.drips]) {
        const tipX = ray.x + Math.cos(ray.angle) * ray.length
        const tipY = ray.y + Math.sin(ray.angle) * ray.length
        furthest = Math.max(furthest, Math.hypot(tipX, tipY) + ray.tipR)
        if (ray.drip > 0) furthest = Math.max(furthest, Math.hypot(tipX, tipY + ray.drip) + ray.tipR)
      }
      // ceil(furthest) + 1 lies in [furthest + 1, furthest + 2). The margin is
      // one pixel, so anything at or past furthest + 2 is real over-allocation.
      expect(splat.radius).toBeGreaterThanOrEqual(furthest + 1)
      expect(splat.radius).toBeLessThan(furthest + 2)
    }
  })
})

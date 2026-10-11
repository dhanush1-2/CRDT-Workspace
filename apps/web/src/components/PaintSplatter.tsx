'use client'

import { useEffect, useRef } from 'react'
import { createRandom } from '@/lib/splatter/random'
import { makeSpecks, makeSplat, PALETTES, splatCount, type Splat } from '@/lib/splatter/geometry'
import { paintSplat } from '@/lib/splatter/paint'
import styles from './canvas-background.module.css'

type Props = {
  strength?: 'off' | 'subtle' | 'bold'
  palette?: 'gallery'
  motion?: 'live' | 'still'
}

// A constant, never Date.now(): the pattern must be the same on every load.
const SEED = 0x5ca77e5

const LAYER_OPACITY = { subtle: 0.38, bold: 0.9 } as const
const LANDING_MS = 650
const FADE_OUT_MS = 2400
const SPECK_PERIOD_MS = 700
// Capped at 1, below the 2 the owner's spec names, for this layer only. The
// splats sit at a third opacity under the weave and behind translucent glass, so the
// extra sharpness is not visible, and the cost is. Re-measured at 1440x900 after the
// 2026-10-02 resize: the whole layer is 5.9 MiB at this cap, against 13.3 at 1.5 and
// 23.6 at 2, with raster cost falling roughly in proportion. Do not raise this
// without re-measuring: the figures and the method are in docs/design/glass-handoff.md.
const MAX_DPR = 1
// The loop redraws at about 30 fps, not at the display rate. Fastest motion here is
// a 650ms landing (about 20 frames at 30 fps). 32 rather than 33.3 so that two 60 Hz
// frames (33.4ms) always qualify despite timer jitter.
const MIN_FRAME_MS = 32
// Nothing is painted in the top 90px of the viewport. The nav is a sticky glass bar
// there, and splat colour read straight through its backdrop-filter as coloured
// streaks inside the bar. Viewport space, not document space: the canvas is absolute
// inside a fixed, full-viewport parent, so canvas y is viewport y.
const NAV_EXCLUSION_PX = 90

// Everything the loop needs per splat. `canvas` is painted once, at build time,
// and reused for the splat's whole life and every re-placement after it.
type Placed = {
  splat: Splat
  canvas: HTMLCanvasElement
  x: number
  y: number
  start: number
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

export function PaintSplatter({ strength = 'subtle', palette = 'gallery', motion = 'live' }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const still = reduced || motion === 'still'

    let dpr = 1
    let width = 0
    let height = 0
    let placed: Placed[] = []
    let specks: ReturnType<typeof makeSpecks> = []
    let random = createRandom(SEED)
    let frame = 0
    // When the last frame was actually drawn. 0 means draw the next one at once.
    let lastDraw = 0
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let hiddenAt = document.hidden ? performance.now() : 0

    // Paint `p` at `scale`, `alpha` and `progress` (0..1 through its life, which
    // drives the drift). One drawImage; the transform carries position, rotation
    // and scale. The image is dpr times larger than its CSS size, so the dpr in
    // the canvas transform and the 1/dpr to bring it back cancel out.
    const drawSplat = (p: Placed, scale: number, alpha: number, progress: number) => {
      const { splat } = p
      const cos = Math.cos(splat.rotation) * scale
      const sin = Math.sin(splat.rotation) * scale
      const cx = (p.x + splat.driftX * progress) * dpr
      const cy = (p.y + splat.driftY * progress) * dpr
      ctx.setTransform(cos, sin, -sin, cos, cx, cy)
      ctx.globalAlpha = alpha
      ctx.drawImage(p.canvas, -p.canvas.width / 2, -p.canvas.height / 2)
    }

    const drawSpecks = (shimmer: (phase: number) => number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const s of specks) {
        ctx.globalAlpha = shimmer(s.phase)
        ctx.fillStyle = s.color
        ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2)
      }
      ctx.globalAlpha = 1
    }

    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    // The single static frame: every splat landed and fully opaque, specks at
    // the middle of their shimmer. No loop is ever started for it.
    const drawStill = () => {
      clear()
      for (const p of placed) drawSplat(p, 1, 1, 0)
      drawSpecks(() => 0.725)
    }

    const draw = (now: number) => {
      clear()
      for (const p of placed) {
        let age = now - p.start
        if (age >= p.splat.life) {
          // Finished: re-place it and reuse its canvas. Nothing is re-rasterised.
          p.x = random.range(0, width)
          p.y = placeY(p.splat.radius)
          p.start = now
          age = 0
        }
        const remaining = p.splat.life - age
        const landing = Math.min(1, age / LANDING_MS)
        const fade = Math.min(1, remaining / FADE_OUT_MS)
        const scale = landing < 1 ? 0.35 + 0.65 * easeOutBack(landing) : 1
        const alpha = Math.min(landing, fade)
        if (alpha > 0) drawSplat(p, scale, alpha, age / p.splat.life)
      }
      drawSpecks((phase) => 0.55 + 0.175 * (1 + Math.sin(now / SPECK_PERIOD_MS + phase)))
    }

    // rAF stays the clock, so the browser's own throttling and the visibility
    // handling still apply. A frame that arrives too soon only reschedules. All
    // motion is derived from `now`, never from a frame count, so a skipped or
    // dropped frame does not slow anything down.
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (lastDraw && now - lastDraw < MIN_FRAME_MS) return
      lastDraw = now
      draw(now)
    }
    const start = () => {
      lastDraw = 0
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }

    // A y for a splat of this radius, never overlapping the exclusion zone.
    //
    // Uniform over the band that is left, rather than rejection sampling with a retry
    // cap: the two give the same distribution, but this draws exactly one PRNG value
    // (as the unconstrained placement did, so the stream stays aligned) and cannot
    // loop. Clamping was the other option and is the wrong one -- it would pile
    // splats along the boundary in a visible line.
    const placeY = (radius: number): number => {
      const lo = NAV_EXCLUSION_PX + radius
      // A viewport shorter than the exclusion zone plus one splat has nowhere legal
      // to put it. Place it past the bottom edge: off-screen is correct, and better
      // than either clamping it into the nav or looping looking for a gap.
      if (lo >= height) return lo
      return random.range(lo, height)
    }

    const release = () => {
      for (const p of placed) {
        p.canvas.width = 0
        p.canvas.height = 0
      }
      placed = []
      specks = []
    }

    const build = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      stop()
      release()

      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      width = w
      height = h
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)

      random = createRandom(SEED)
      const colors = PALETTES[palette]
      const now = performance.now()
      for (let i = 0, n = splatCount(w, h); i < n; i += 1) {
        const splat = makeSplat(random, random.pick(colors), random.range(0.7, 1.4))
        placed.push({
          splat,
          canvas: paintSplat(splat, dpr),
          x: random.range(0, w),
          y: placeY(splat.radius),
          // Start somewhere inside its own life so they do not all land at once.
          start: now - random.range(0, splat.life),
        })
      }
      specks = makeSpecks(random, w, h, colors, undefined, NAV_EXCLUSION_PX)

      if (still) drawStill()
      else if (!document.hidden) start()
    }

    build()

    let lastSize = `${canvas.clientWidth}x${canvas.clientHeight}@${window.devicePixelRatio}`
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const size = `${canvas.clientWidth}x${canvas.clientHeight}@${window.devicePixelRatio}`
        if (size === lastSize) return
        lastSize = size
        build()
      }, 150)
    }

    // A loop burning CPU on a background tab is a defect. Hold the clock too, so
    // returning does not make every splat expire and land at the same instant.
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = performance.now()
        stop()
      } else {
        const away = hiddenAt ? performance.now() - hiddenAt : 0
        for (const p of placed) p.start += away
        start()
      }
    }

    window.addEventListener('resize', onResize)
    // Reduced motion, or an explicit still, has one frame drawn by build() and
    // never requests an animation frame, so there is nothing to pause.
    if (!still) document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [strength, palette, motion])

  if (strength === 'off') return null

  return (
    <canvas
      ref={ref}
      className={styles.splatter}
      style={{ opacity: LAYER_OPACITY[strength] }}
      data-testid="paint-splatter"
      aria-hidden="true"
    />
  )
}

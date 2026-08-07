"use client"

import { useEffect, useRef } from "react"
import { cn } from "./lib"
import { rgb } from "./palette"
import {
  BAYER4,
  clamp01,
  fnv1a,
  hueFill,
  type PixelBloom,
  pixelBloomStyle,
  pixelPrefersReducedMotion,
  xorshift32,
} from "./pixel"

// 8×8 cells, mirrored across one axis → 32 free pattern bits. With the mirror
// axis bit and 180 hues that's 2^33 × 180 ≈ 1.5 trillion distinct avatars.
const GRID = 8
const CELL_PX = 4 // backing px per cell → a 32×32 canvas, scaled up pixelated

export type AvatarMirror = "auto" | "horizontal" | "vertical"

export type AvatarDirection = "auto" | "up" | "down" | "left" | "right"

export type DitherAvatarProps = {
  /** The seed — same name, same avatar, every time. */
  name: string
  /** Hue override (0–360). Derived from the name when omitted. */
  hue?: number
  /** Direction the dither fades toward transparent. "auto" picks one from the
   * name so each seed fades a different way. */
  direction?: AvatarDirection
  /** Mirror axis. "auto" picks one from the name — half the avatars fold
   * left/right, half fold top/bottom. */
  mirror?: AvatarMirror
  /** Square size in px. Omit to size via className (e.g. `size-12`). */
  size?: number
  /** Glow on the dither fill. */
  bloom?: PixelBloom
  /** Play the Bayer-ordered materialize entrance. */
  animate?: boolean
  animationDuration?: number
  /** Bump to replay the entrance. */
  replayToken?: number
  className?: string
}

type Rgb = [number, number, number]

export type DitherAvatarSeedUser = {
  id?: string | null
  email?: string | null
  name?: string | null
}

/**
 * Canonical dither seed for a human. Every surface that renders a person's
 * dither avatar must derive the seed from THIS precedence — stable user id,
 * then email, then display name — so one human gets one avatar everywhere.
 * Ids are what the rest of the app keys on; emails and display names both
 * collide, so a seed that falls back past the id will not match that human's
 * avatar elsewhere.
 */
export function ditherAvatarSeed(user: DitherAvatarSeedUser): string {
  return user.id ?? user.email ?? user.name ?? "ryu"
}

type AvatarModel = {
  on: boolean[]
  density: number[]
  fill: Rgb
  direction: Exclude<AvatarDirection, "auto">
}

const DRAWN_DIRECTIONS = ["right", "down", "left", "up"] as const

/**
 * Everything the seed decides, drawn from ONE PRNG stream. It lives apart from
 * `avatarModel` so other surfaces can ask the seed for a single one of its
 * draws — the hue, say — without re-deriving the stream order and silently
 * drifting out of step with the avatar the answer is supposed to match.
 */
function seedDraw(name: string) {
  const rand = xorshift32(fnv1a(name))
  const bits = Array.from({ length: 32 }, () => rand() < 0.5)
  const drawnVertical = rand() < 0.5
  const drawnHue = Math.floor(rand() * 180) * 2
  const halfDensity = Array.from({ length: 32 }, () => 0.55 + rand() * 0.45)
  const drawnDirection =
    DRAWN_DIRECTIONS[Math.floor(rand() * DRAWN_DIRECTIONS.length)] ?? "right"
  return { bits, drawnVertical, drawnHue, halfDensity, drawnDirection }
}

/**
 * The hue (0–360) this seed's avatar is drawn in. Exported so a surface that
 * puts something else beside the avatar — the waitlist pass paints its shader
 * backdrop in it — is coloured by the same draw rather than by a second,
 * lookalike hash that would disagree for some seeds.
 */
export function ditherAvatarHue(name: string): number {
  return seedDraw(name).drawnHue
}

function avatarModel(
  name: string,
  hueProp: number | undefined,
  mirrorProp: AvatarMirror,
  directionProp: AvatarDirection
): AvatarModel {
  const { bits, drawnVertical, drawnHue, halfDensity, drawnDirection } =
    seedDraw(name)

  const vertical =
    mirrorProp === "auto" ? drawnVertical : mirrorProp === "vertical"
  const hue = hueProp ?? drawnHue
  const direction = directionProp === "auto" ? drawnDirection : directionProp

  const on = new Array<boolean>(GRID * GRID)
  const density = new Array<number>(GRID * GRID)
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = vertical
        ? Math.min(r, GRID - 1 - r) * GRID + c
        : r * (GRID / 2) + Math.min(c, GRID - 1 - c)
      on[r * GRID + c] = bits[i]
      density[r * GRID + c] = halfDensity[i]
    }
  }
  return { on, density, fill: hueFill(hue), direction }
}

/** Fraction 0→1 along the gradient direction for cell (r,c). */
function directionT(
  direction: Exclude<AvatarDirection, "auto">,
  r: number,
  c: number
): number {
  const max = GRID - 1
  switch (direction) {
    case "right":
      return c / max
    case "left":
      return 1 - c / max
    case "down":
      return r / max
    default:
      return 1 - r / max
  }
}

/**
 * Paint the avatar, optionally sweeping cells in with the Bayer-ordered
 * materialize entrance. Lives outside the component (same shape as the chart
 * canvases). Returns a cleanup that cancels the entrance loop.
 */
function paintAvatar(
  canvas: HTMLCanvasElement,
  bloomCanvas: HTMLCanvasElement | null,
  model: AvatarModel,
  animate: boolean,
  duration: number
): (() => void) | undefined {
  const ctx = canvas.getContext("2d")
  if (!ctx) return undefined
  const px = GRID * CELL_PX
  canvas.width = px
  canvas.height = px
  const bloomCtx = bloomCanvas?.getContext("2d") ?? null
  if (bloomCanvas) {
    bloomCanvas.width = px
    bloomCanvas.height = px
  }

  const draw = (progress: number) => {
    ctx.clearRect(0, 0, px, px)
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (!model.on[r * GRID + c]) continue
        // Cells materialize in Bayer order — the entrance is made of the same
        // matrix as the texture.
        const start = BAYER4[r % 4][c % 4] * 0.7
        const cellAlpha = clamp01((progress - start) / 0.3)
        if (cellAlpha <= 0) continue
        const density = model.density[r * GRID + c]
        const base = 0.35 + 0.65 * density
        // One hue that fades to transparent along the direction.
        const fade = 0.3 + 0.7 * (1 - directionT(model.direction, r, c))
        for (let py = 0; py < CELL_PX; py++) {
          for (let pxi = 0; pxi < CELL_PX; pxi++) {
            const gx = c * CELL_PX + pxi
            const gy = r * CELL_PX + py
            const lit = density > BAYER4[gy & 3][gx & 3]
            const alpha = (lit ? base : base * 0.35) * cellAlpha * fade
            ctx.fillStyle = rgb(model.fill, 1, alpha)
            ctx.fillRect(gx, gy, 1, 1)
          }
        }
      }
    }
    if (bloomCtx) {
      bloomCtx.clearRect(0, 0, px, px)
      bloomCtx.drawImage(canvas, 0, 0)
    }
  }

  if (!animate || pixelPrefersReducedMotion()) {
    draw(1)
    return undefined
  }

  let raf = 0
  const startTime = performance.now()
  const tick = (now: number) => {
    const t = clamp01((now - startTime) / duration)
    draw(1 - (1 - t) ** 3)
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

/**
 * Generative dithered avatar — a mirrored 8×8 pixel glyph derived from a name,
 * rendered with the ordered-dither texture the charts are made of. Same name,
 * same avatar; ~1.5 trillion combinations across pattern, mirror axis, and hue.
 */
export function DitherAvatar({
  name,
  hue,
  direction = "auto",
  mirror = "auto",
  size,
  bloom = "off",
  animate = true,
  animationDuration = 600,
  replayToken = 0,
  className,
}: DitherAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return paintAvatar(
      canvas,
      bloomRef.current,
      avatarModel(name, hue, mirror, direction),
      animate,
      animationDuration
    )
  }, [
    name,
    hue,
    direction,
    mirror,
    animate,
    animationDuration,
    replayToken,
    bloom,
  ])

  const bloomStyle = pixelBloomStyle(bloom)

  return (
    <div
      role="img"
      aria-label={`${name} avatar`}
      className={cn("relative", className)}
      style={size != null ? { width: size, height: size } : undefined}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      {bloomStyle && (
        <canvas
          ref={bloomRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={bloomStyle}
        />
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { X, Crown, Star, Sparkles, Trophy } from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Teacher {
  teacher_code: string
  full_name: string
  center: string
  total_score: number
  avatar_url: string | null
}
interface TopTeachersResponse { success: boolean; data: Teacher[] }

interface Rect { x: number; y: number; w: number; h: number }

// ─── Utils ───────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json())

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase()
    : (p[p.length - 2][0] + p[p.length - 1][0]).toUpperCase()
}

function fittedFontSize(length: number, minPx: number, maxPx: number, vwFactor: number) {
  const safeLength = Math.max(length, 10)
  const preferredVw = Math.max(minPx / 3.9, vwFactor / safeLength)
  return `clamp(${minPx}px, ${preferredVw.toFixed(3)}vw, ${maxPx}px)`
}

// ─── Easing ──────────────────────────────────────────────────────────────────

const E = {
  outExpo: (t: number) => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  inQuart: (t: number) => t ** 4,
  inOutCubic: (t: number) => t < .5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2,
  outElastic: (t: number) => {
    if (t <= 0) return 0; if (t >= 1) return 1
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1
  },
}

// ─── Canvas Genie Painter ─────────────────────────────────────────────────────

function paintGenie(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, sw: number, sh: number,
  tx: number, ty: number, tw: number, th: number,
  topT: number, botT: number,
  alpha: number,
  isClosing = false,
) {
  const lerpX = (a: number, b: number, t: number) => a + (b - a) * t
  const lerpY = (a: number, b: number, t: number) => a + (b - a) * t

  const stl = { x: sx - sw / 2, y: sy - sh / 2 }
  const str = { x: sx + sw / 2, y: sy - sh / 2 }
  const sbl = { x: sx - sw / 2, y: sy + sh / 2 }
  const sbr = { x: sx + sw / 2, y: sy + sh / 2 }

  const ttl = { x: tx, y: ty }
  const ttr = { x: tx + tw, y: ty }
  const tbl = { x: tx, y: ty + th }
  const tbr = { x: tx + tw, y: ty + th }

  const TL = { x: lerpX(stl.x, ttl.x, topT), y: lerpY(stl.y, ttl.y, topT) }
  const TR = { x: lerpX(str.x, ttr.x, topT), y: lerpY(str.y, ttr.y, topT) }
  const BL = { x: lerpX(sbl.x, tbl.x, botT), y: lerpY(sbl.y, tbl.y, botT) }
  const BR = { x: lerpX(sbr.x, tbr.x, botT), y: lerpY(sbr.y, tbr.y, botT) }

  const pinchFactor = Math.abs(topT - botT)
  const pinchPx = pinchFactor * Math.min(tw, th) * 0.55 * Math.sin(Math.PI * Math.min(topT, botT + 0.1))

  const lcpT = { x: TL.x + pinchPx, y: TL.y + (BL.y - TL.y) * 0.35 }
  const lcpB = { x: BL.x + pinchPx, y: TL.y + (BL.y - TL.y) * 0.65 }
  const rcpT = { x: TR.x - pinchPx, y: TR.y + (BR.y - TR.y) * 0.35 }
  const rcpB = { x: BR.x - pinchPx, y: TR.y + (BR.y - TR.y) * 0.65 }

  // Build a vertical gradient matching the champagne/ivory popup background
  const minY = Math.min(TL.y, TR.y)
  const maxY = Math.max(BL.y, BR.y)
  const grad = ctx.createLinearGradient(0, minY, 0, maxY)
  if (isClosing) {
    // Closing: champagne top → warm ivory bottom
    grad.addColorStop(0, `rgba(244, 236, 221, ${alpha * 0.92})`)
    grad.addColorStop(0.4, `rgba(255, 249, 237, ${alpha * 0.82})`)
    grad.addColorStop(1, `rgba(255, 249, 237, ${alpha * 0.55})`)
  } else {
    // Opening: ivory top flowing into popup background
    grad.addColorStop(0, `rgba(255, 249, 237, ${alpha * 0.65})`)
    grad.addColorStop(0.5, `rgba(244, 236, 221, ${alpha * 0.88})`)
    grad.addColorStop(1, `rgba(244, 236, 221, ${alpha * 0.95})`)
  }

  ctx.beginPath()
  ctx.moveTo(TL.x, TL.y)
  ctx.lineTo(TR.x, TR.y)
  ctx.bezierCurveTo(rcpT.x, rcpT.y, rcpB.x, rcpB.y, BR.x, BR.y)
  ctx.lineTo(BL.x, BL.y)
  ctx.bezierCurveTo(lcpB.x, lcpB.y, lcpT.x, lcpT.y, TL.x, TL.y)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // Subtle gold shimmer edge
  ctx.strokeStyle = `rgba(212, 180, 106, ${alpha * 0.45})`
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// ─── Particle system ─────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number
  size: number; opacity: number; decay: number; color: string
}

interface Confetti {
  x: number; y: number; vy: number; vx: number
  size: number; rotation: number; vRot: number; color: string; opacity: number; points: number
}

function spawnParticles(cx: number, cy: number, count: number): Particle[] {
  // Champagne & gold particle palette
  const colors = ['#d4b46a', '#e8c97a', '#f4ecd5', '#ffffff', '#c9a84c', '#ffe8a0', '#f5d78e']
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 1.5 + Math.random() * 4
    return {
      x: cx + (Math.random() - .5) * 40,
      y: cy + (Math.random() - .5) * 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      size: 2 + Math.random() * 4,
      opacity: 0.8 + Math.random() * 0.2,
      decay: 0.012 + Math.random() * 0.018,
      color: colors[Math.floor(Math.random() * colors.length)],
    }
  })
}

function spawnConfetti(width: number, count: number): Confetti[] {
  // Champagne gold confetti palette
  const colors = ['#d4b46a', '#e8c97a', '#c9a84c', '#f5d78e', '#ffe8a0', '#ffffff', '#f4ecd5', '#f0d89a']
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: -Math.random() * 300,
    vy: 1.5 + Math.random() * 2.5,
    vx: (Math.random() - 0.5) * 1.2,
    size: 3 + Math.random() * 5,
    rotation: Math.random() * Math.PI * 2,
    vRot: (Math.random() - 0.5) * 0.1,
    color: colors[Math.floor(Math.random() * colors.length)],
    opacity: 1,
    points: Math.random() > 0.7 ? 5 : 4,
  }))
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: number, color: string, opacity: number) {
  ctx.save()
  ctx.translate(x, y)
  const twinkle = 0.7 + Math.sin(Date.now() * 0.01 + x) * 0.3
  const currentOpacity = opacity * twinkle
  ctx.beginPath()
  ctx.globalAlpha = currentOpacity
  ctx.fillStyle = color
  const innerRadius = p === 4 ? r * 0.25 : r * 0.4
  for (let i = 0; i < p * 2; i++) {
    const radius = i % 2 === 0 ? r : innerRadius
    const angle = (i * Math.PI) / p
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
  }
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = currentOpacity * 0.4
  ctx.beginPath()
  ctx.arc(0, 0, r * 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function ConfettiRain({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const parent = canvas.parentElement
      if (parent) {
        canvas.width = parent.clientWidth
        canvas.height = parent.clientHeight
      }
    }
    resize()
    window.addEventListener('resize', resize)
    const particles = spawnConfetti(canvas.width, 80)
    let animationFrame: number
    const render = () => {
      const ctx = canvas.getContext('2d', { alpha: true })
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        p.y += p.vy; p.x += p.vx; p.rotation += p.vRot
        if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width }
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        drawStar(ctx, 0, 0, p.size, p.points, p.color, p.opacity)
        ctx.restore()
      })
      animationFrame = requestAnimationFrame(render)
    }
    render()
    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [active])
  if (!active) return null
  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />
}

// ─── 3D Tilt Card ─────────────────────────────────────────────────────────────

interface PodiumCardProps {
  teacher: { teacher_code: string; full_name: string; center: string; total_score: number; avatar_url: string | null; rank: number }
  idx: number
  animCls: string
  triggerAnimate: boolean
}

const PodiumCard = memo(function PodiumCard({ teacher, idx, animCls, triggerAnimate }: PodiumCardProps) {
  const cardEl = useRef<HTMLDivElement>(null)
  const glowEl = useRef<HTMLDivElement>(null)
  const rafTilt = useRef<number | null>(null)
  const targetTilt = useRef({ x: 0, y: 0 })
  const currentTilt = useRef({ x: 0, y: 0 })
  const sparkleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([])
  const sparkleId = useRef(0)
  const [displayScore, setDisplayScore] = useState(0)

  const isFirst = idx === 1

  useEffect(() => {
    if (!triggerAnimate) {
      setDisplayScore(0)
      return
    }
    let startTimestamp: number | null = null
    const duration = 1200
    const target = teacher.total_score
    let rafId: number
    const animate = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp
      const progress = Math.min((timestamp - startTimestamp) / duration, 1)
      const easeProgress = 1 - Math.pow(1 - progress, 3)
      setDisplayScore(easeProgress * target)
      if (progress < 1) {
        rafId = requestAnimationFrame(animate)
      }
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [triggerAnimate, teacher.total_score])

  const configs = [
    { // Hạng II
      bg: '#ffffff',
      border: 'border-[6px]',
      borderColor: '#ffffff',
      avatarBorderColor: '#ffffff',
      ringCls: '',
      badgeBg: '#ffffff',
      badgeBorder: '1px solid #e5e7eb',
      badgeTextColor: '#ef4444',
      scoreBg: '#ffffff',
      scoreBorder: '1px solid #e5e7eb',
      scoreTextColor: '#ef4444',
      textColor: '#ef4444',
      subTextColor: '#4b5563',
      sloganColor: '#ef4444',
      shadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
      glow: 'transparent',
      tiltGlow: 'transparent',
      avatarGlow: 'transparent',
      avatarGlowSoft: 'transparent',
      starColor: '#ef4444',
      starFill: '#ef4444',
      captionBg: '#ffffff',
      captionBorder: 'transparent',
      accentLine: 'transparent',
      veilBg: 'transparent',
      sheenBg: 'transparent',
      shimmerBg: 'transparent',
    },
    { // Hạng I
      bg: '#ffffff',
      border: 'border-[6px]',
      borderColor: '#ffffff',
      avatarBorderColor: '#ffffff',
      ringCls: '',
      badgeBg: '#ffffff',
      badgeBorder: '1px solid #e5e7eb',
      badgeTextColor: '#ef4444',
      scoreBg: '#ffffff',
      scoreBorder: '1px solid #e5e7eb',
      scoreTextColor: '#ef4444',
      textColor: '#ef4444',
      subTextColor: '#4b5563',
      sloganColor: '#ef4444',
      shadow: '0 25px 30px -5px rgba(0, 0, 0, 0.4), 0 15px 15px -5px rgba(0, 0, 0, 0.3)',
      glow: 'transparent',
      tiltGlow: 'transparent',
      avatarGlow: 'transparent',
      avatarGlowSoft: 'transparent',
      starColor: '#ef4444',
      starFill: '#ef4444',
      captionBg: '#ffffff',
      captionBorder: 'transparent',
      accentLine: 'transparent',
      veilBg: 'transparent',
      sheenBg: 'transparent',
      shimmerBg: 'transparent',
    },
    { // Hạng III
      bg: '#ffffff',
      border: 'border-[6px]',
      borderColor: '#ffffff',
      avatarBorderColor: '#ffffff',
      ringCls: '',
      badgeBg: '#ffffff',
      badgeBorder: '1px solid #e5e7eb',
      badgeTextColor: '#ef4444',
      scoreBg: '#ffffff',
      scoreBorder: '1px solid #e5e7eb',
      scoreTextColor: '#ef4444',
      textColor: '#ef4444',
      subTextColor: '#4b5563',
      sloganColor: '#ef4444',
      shadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
      glow: 'transparent',
      tiltGlow: 'transparent',
      avatarGlow: 'transparent',
      avatarGlowSoft: 'transparent',
      starColor: '#ef4444',
      starFill: '#ef4444',
      captionBg: '#ffffff',
      captionBorder: 'transparent',
      accentLine: 'transparent',
      veilBg: 'transparent',
      sheenBg: 'transparent',
      shimmerBg: 'transparent',
    },
  ]
  const cfg = configs[idx]
  const nameFontSize = fittedFontSize(teacher.full_name.length, isFirst ? 11 : 9, isFirst ? 16 : 13, isFirst ? 60 : 45)
  const centerFontSize = fittedFontSize(teacher.center.length, isFirst ? 8.5 : 7.5, isFirst ? 12 : 10.5, isFirst ? 55 : 42)

  const animateTilt = useCallback(function animateTiltFrame() {
    currentTilt.current.x += (targetTilt.current.x - currentTilt.current.x) * 0.12
    currentTilt.current.y += (targetTilt.current.y - currentTilt.current.y) * 0.12
    const { x, y } = currentTilt.current
    if (cardEl.current) {
      const scale = window.innerWidth < 768 ? 1 : 1.04
      cardEl.current.style.transform = `perspective(900px) rotateX(${x}deg) rotateY(${y}deg) scale3d(${scale},${scale},${scale})`
    }
    if (glowEl.current) {
      const gx = 50 + y * 3; const gy = 50 - x * 3
      glowEl.current.style.background = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.6) 0%, ${cfg.tiltGlow} 36%, transparent 70%), ${cfg.glow}`
    }
    if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) rafTilt.current = requestAnimationFrame(animateTiltFrame)
    else rafTilt.current = null
  }, [cfg.glow, cfg.tiltGlow])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardEl.current; if (!el) return
    const r = el.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width - 0.5
    const ny = (e.clientY - r.top) / r.height - 0.5
    targetTilt.current = { x: -ny * 14, y: nx * 14 }
    if (!rafTilt.current) rafTilt.current = requestAnimationFrame(animateTilt)
    if (sparkleTimeout.current) return
    sparkleTimeout.current = setTimeout(() => { sparkleTimeout.current = null }, 120)
    const id = ++sparkleId.current; const sx = e.clientX - r.left; const sy = e.clientY - r.top
    setSparkles(prev => [...prev.slice(-6), { id, x: sx, y: sy }])
    setTimeout(() => setSparkles(prev => prev.filter(s => s.id !== id)), 700)
  }, [animateTilt])

  const onMouseLeave = useCallback(() => {
    targetTilt.current = { x: 0, y: 0 }
    if (!rafTilt.current) rafTilt.current = requestAnimationFrame(animateTilt)
    if (cardEl.current) cardEl.current.style.transition = 'transform 0.6s cubic-bezier(0.34,1.2,0.64,1)'
    setTimeout(() => { if (cardEl.current) cardEl.current.style.transition = '' }, 600)
  }, [animateTilt])

  useEffect(() => () => { if (rafTilt.current) cancelAnimationFrame(rafTilt.current) }, [])

  return (
    <div
      className={cn('relative flex-shrink cursor-pointer flex flex-col', `card-podium-${idx === 1 ? 1 : idx === 0 ? 2 : 3}`, animCls, isFirst ? 'z-10' : 'z-0')}
      style={{ perspective: '900px', transform: 'translateZ(0)' }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* Rank label above card */}
      <div className="flex items-center justify-center gap-1 mb-1.5 sm:mb-2">
        {idx === 1 && <Trophy className={cn("text-yellow-400 fill-yellow-400", isFirst ? "w-3.5 h-3.5 sm:w-4 sm:h-4" : "w-3 h-3")} />}
        {idx === 0 && <Crown className={cn("text-slate-300 fill-slate-300", "w-3 h-3 sm:w-3.5 sm:h-3.5")} />}
        {idx === 2 && <Star className={cn("text-orange-400 fill-orange-400", "w-3 h-3 sm:w-3.5 sm:h-3.5")} />}
        <span className={cn(
          "font-black tracking-widest uppercase",
          isFirst ? "text-[11px] sm:text-[13px] text-yellow-300" : "text-[10px] sm:text-[11px] text-white/70"
        )} style={{ textShadow: isFirst ? '0 0 10px rgba(251,191,36,0.6)' : undefined }}>
          Hạng {teacher.rank === 1 ? 'I' : teacher.rank === 2 ? 'II' : 'III'}
        </span>
      </div>

      <div
        ref={cardEl}
        className={cn('relative w-full flex flex-col rounded-[20px] sm:rounded-[24px] overflow-hidden flex-1', cfg.border)}
        style={{
          background: cfg.bg,
          boxShadow: cfg.shadow,
          willChange: 'transform',
          borderColor: cfg.borderColor,
          isolation: 'isolate',
          WebkitMaskImage: '-webkit-radial-gradient(white, black)',
          height: '100%',
        }}
      >
        {/* Subtle overlay layers — kept minimal */}
        <div ref={glowEl} className="absolute inset-0 pointer-events-none transition-none z-10" style={{ background: cfg.glow, borderRadius: '20px' }} />
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded-[20px]">
          <div className="absolute -inset-full top-0 left-0 w-1/2 h-full skew-x-[-25deg] animate-[shimmer-sweep_6s_infinite_linear]" style={{ backgroundImage: cfg.shimmerBg, opacity: 0.35 }} />
        </div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent z-20 pointer-events-none" />

        {/* Avatar area — fills top portion */}
        <div className="relative w-full flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          {/* Avatar image */}
          <div className="w-full h-full relative">
            {teacher.avatar_url
              ? <img src={teacher.avatar_url} alt={teacher.full_name} className="w-full h-full object-cover object-top" />
              : <div className="w-full h-full flex items-center justify-center" style={{ background: cfg.badgeBg }}>
                  <span className={cn('font-black text-gray-400', isFirst ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-3xl')}>{initials(teacher.full_name)}</span>
                </div>
            }
          </div>

          {/* Score badge — overlaid bottom-center of image */}
          <div className={cn(
            "absolute bottom-3 left-1/2 -translate-x-1/2 z-20 rounded-full font-black tracking-wider flex items-center gap-1 px-3 py-1 shadow-sm",
            isFirst ? "text-[11px] sm:text-[13px]" : "text-[10px] sm:text-[11px]"
          )}
            style={{
              background: cfg.scoreBg,
              color: cfg.scoreTextColor,
              border: cfg.scoreBorder,
            }}>
            <Trophy className={cn("w-3 h-3 sm:w-3.5 sm:h-3.5", "text-yellow-500 fill-yellow-500")} />
            <span className="leading-none">
              {displayScore.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Caption — white bottom section */}
        <div className="relative z-20 px-2 sm:px-3 py-3 sm:py-4 flex flex-col items-center justify-center gap-1.5" style={{ background: cfg.captionBg }}>
          <h4 className="w-full font-black leading-tight tracking-tight text-center"
            style={{
              color: cfg.textColor,
              fontSize: nameFontSize,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
            {teacher.full_name}
          </h4>
          <div className="inline-flex items-center justify-center px-3 py-0.5 rounded-full border border-gray-200 bg-white shadow-sm"
            style={{
              border: cfg.badgeBorder,
              background: cfg.badgeBg,
            }}>
            <p className="font-bold text-center leading-snug"
              style={{
                color: cfg.subTextColor,
                fontSize: centerFontSize,
                display: '-webkit-box',
                WebkitLineClamp: 1,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
              title={teacher.center}>
              {teacher.center}
            </p>
          </div>
        </div>

        {sparkles.map(s => (
          <div key={s.id} className="absolute pointer-events-none z-30" style={{ left: s.x, top: s.y, animation: 'sparkle-pop 0.7s ease-out forwards' }}>
            <Star className="w-3 h-3 text-white fill-white/80 -translate-x-1/2 -translate-y-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
})

// ─── Popup UI Shell ──────────────────────────────────────────────────────────

interface PopupUIProps {
  cardRef: React.RefObject<HTMLDivElement | null>
  showCard: boolean
  contentPhase: number
  podium: { teacher_code: string; full_name: string; center: string; total_score: number; avatar_url: string | null; rank: number }[]
  onClose: () => void
  activeConfetti: boolean
}

function PopupUI({ cardRef, showCard, contentPhase, podium, onClose, activeConfetti }: PopupUIProps) {
  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center p-2 sm:p-4 pointer-events-none select-none">
      <style>{`
        @keyframes shimmer-sweep { 0% { transform:translateX(-120%) skewX(-18deg); } 100% { transform:translateX(320%) skewX(-18deg); } }
        @keyframes ring-expand { 0% { transform:scale(0.2); opacity:1; } 100% { transform:scale(3.2); opacity:0; } }
        @keyframes crown-bob { 0%,100% { transform:translateY(0) rotate(-4deg) scale(1); } 50% { transform:translateY(-6px) rotate(4deg) scale(1.05); } }
        @keyframes card-slide-left { from { opacity:0; transform:translateX(-20px) rotate(-4deg) scale(0.95); } to { opacity:1; transform:translateX(0) rotate(-2.5deg) scale(1); } }
        @keyframes card-slide-center { from { opacity:0; transform:translateY(20px) scale(0.95); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes card-slide-right { from { opacity:0; transform:translateX(20px) rotate(4deg) scale(0.95); } to { opacity:1; transform:translateX(0) rotate(2.5deg) scale(1); } }
        @keyframes title-reveal { from { opacity:0; transform:translateY(16px); filter:blur(4px); } to { opacity:1; transform:translateY(0); filter:blur(0); } }
        @keyframes sparkle-pop { 0% { transform:translate(-50%,-50%) scale(0) rotate(0deg); opacity:1; } 50% { transform:translate(-50%,-80%) scale(1.4) rotate(180deg); opacity:0.9; } 100% { transform:translate(-50%,-120%) scale(0) rotate(360deg); opacity:0; } }
        @keyframes float-orb { 0%,100% { transform:translateY(0) translateX(0) scale(1); } 33% { transform:translateY(-22px) translateX(10px) scale(1.1); } 66% { transform:translateY(-10px) translateX(-12px) scale(0.93); } }
        @keyframes wave-slow { 0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); } 33% { transform: translate(-3%, 2%) scale(1.06) rotate(3deg); } 66% { transform: translate(2%, -3%) scale(0.97) rotate(-2deg); } }
        @keyframes wave-medium { 0%, 100% { transform: translate(0, 0) scale(1.1) rotate(0deg); } 33% { transform: translate(3%, -2%) scale(1.02) rotate(-4deg); } 66% { transform: translate(-2%, 3%) scale(1.12) rotate(2deg); } }
        @keyframes wave-fast { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(4%, -4%) scale(0.94); } }
        @keyframes drift-slow { 0% { transform: translateX(-12%) translateY(0) rotate(-15deg); } 50% { transform: translateX(12%) translateY(-6%) rotate(-15deg); } 100% { transform: translateX(-12%) translateY(0) rotate(-15deg); } }
        @keyframes ripple-out { 0% { transform: translate(-50%,-50%) scale(0.3); opacity: 0.7; } 100% { transform: translate(-50%,-50%) scale(2.8); opacity: 0; } }
        @keyframes ripple-out-2 { 0% { transform: translate(-50%,-50%) scale(0.5); opacity: 0.5; } 100% { transform: translate(-50%,-50%) scale(3.2); opacity: 0; } }
        @keyframes orb-drift-1 { 0%,100% { transform: translate(0,0) scale(1); } 25% { transform: translate(8%,-6%) scale(1.08); } 50% { transform: translate(-4%,8%) scale(0.95); } 75% { transform: translate(-8%,-3%) scale(1.05); } }
        @keyframes orb-drift-2 { 0%,100% { transform: translate(0,0) scale(1); } 25% { transform: translate(-6%,8%) scale(1.1); } 50% { transform: translate(10%,4%) scale(0.92); } 75% { transform: translate(4%,-8%) scale(1.06); } }
        @keyframes orb-drift-3 { 0%,100% { transform: translate(0,0) scale(1.05); } 25% { transform: translate(5%,10%) scale(0.95); } 50% { transform: translate(-8%,-5%) scale(1.12); } 75% { transform: translate(6%,-8%) scale(0.98); } }
        @keyframes pulse-soft { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.12); } }
        .anim-slide-left { animation: card-slide-left 0.6s cubic-bezier(0.34,1.25,0.64,1) 0.4s both; }
        .anim-slide-center { animation: card-slide-center 0.7s cubic-bezier(0.34,1.35,0.64,1) 0.3s both; }
        .anim-slide-right { animation: card-slide-right 0.6s cubic-bezier(0.34,1.25,0.64,1) 0.4s both; }
        .anim-title-reveal { animation: title-reveal 0.55s cubic-bezier(0.34,1.2,0.64,1) 0.1s both; }

        .card-podium-1 {
          width: 36%;
          height: 290px;
        }
        .card-podium-2 {
          width: 31%;
          height: 262px;
        }
        .card-podium-3 {
          width: 28%;
          height: 238px;
        }
        @media (min-width: 640px) {
          .card-podium-1 {
            width: 34%;
            height: 348px;
          }
          .card-podium-2 {
            width: 30%;
            height: 316px;
          }
          .card-podium-3 {
            width: 26%;
            height: 282px;
          }
        }
        @media (min-width: 768px) {
          .card-podium-1 {
            width: 260px;
            height: 420px;
          }
          .card-podium-2 {
            width: 228px;
            height: 380px;
          }
          .card-podium-3 {
            width: 196px;
            height: 340px;
          }
        }
      `}</style>

       <div
         ref={cardRef}
         className={cn('relative w-full max-w-[820px] max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] pointer-events-auto overflow-y-auto overflow-x-hidden rounded-[1.35rem] sm:rounded-[2rem] transition-opacity duration-300', showCard ? 'opacity-100' : 'opacity-0 pointer-events-none')}
         style={{
           background: 'radial-gradient(ellipse at 30% 20%, #9f1239 0%, #be123c 25%, #dc2626 50%, #b91c1c 75%, #7f1d1d 100%)',
           boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.15)',
           transform: 'translateZ(0)',
         }}
       >
        <ConfettiRain active={activeConfetti} />
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[1.35rem] sm:rounded-[2rem]">

          {/* ── Deep crimson base wave orbs ── */}
          <div className="absolute -top-[20%] -left-[15%] w-[75%] h-[75%] rounded-full blur-[90px]"
            style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.55) 0%, rgba(185,28,28,0.25) 60%, transparent 100%)', animation: 'orb-drift-1 18s ease-in-out infinite' }} />
          <div className="absolute -bottom-[20%] -right-[15%] w-[80%] h-[80%] rounded-full blur-[100px]"
            style={{ background: 'radial-gradient(circle, rgba(220,38,38,0.5) 0%, rgba(153,27,27,0.2) 60%, transparent 100%)', animation: 'orb-drift-2 22s ease-in-out infinite' }} />
          <div className="absolute top-[30%] -right-[20%] w-[65%] h-[65%] rounded-full blur-[80px]"
            style={{ background: 'radial-gradient(circle, rgba(185,28,28,0.45) 0%, transparent 70%)', animation: 'orb-drift-3 16s ease-in-out infinite' }} />

          {/* ── Gold / amber accent waves ── */}
          <div className="absolute top-[5%] left-[40%] w-[45%] h-[40%] rounded-full blur-[70px]"
            style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.28) 0%, rgba(245,158,11,0.12) 60%, transparent 100%)', animation: 'wave-slow 14s ease-in-out infinite' }} />
          <div className="absolute bottom-[5%] left-[10%] w-[50%] h-[40%] rounded-full blur-[75px]"
            style={{ background: 'radial-gradient(circle, rgba(234,179,8,0.22) 0%, transparent 70%)', animation: 'wave-medium 17s ease-in-out infinite reverse' }} />
          <div className="absolute top-[50%] left-[25%] w-[35%] h-[35%] rounded-full blur-[60px]"
            style={{ background: 'radial-gradient(circle, rgba(253,224,71,0.18) 0%, transparent 70%)', animation: 'wave-fast 10s ease-in-out infinite' }} />

          {/* ── Rose / pink accent ── */}
          <div className="absolute top-[15%] -left-[5%] w-[40%] h-[45%] rounded-full blur-[65px]"
            style={{ background: 'radial-gradient(circle, rgba(244,63,94,0.3) 0%, rgba(190,18,60,0.12) 60%, transparent 100%)', animation: 'orb-drift-2 20s ease-in-out infinite 3s' }} />
          <div className="absolute -bottom-[10%] right-[20%] w-[45%] h-[40%] rounded-full blur-[70px]"
            style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.22) 0%, transparent 70%)', animation: 'orb-drift-1 24s ease-in-out infinite 5s' }} />

          {/* ── Orange warm glow ── */}
          <div className="absolute top-[60%] -left-[10%] w-[50%] h-[50%] rounded-full blur-[80px]"
            style={{ background: 'radial-gradient(circle, rgba(251,146,60,0.25) 0%, rgba(234,88,12,0.1) 60%, transparent 100%)', animation: 'wave-slow 19s ease-in-out infinite reverse' }} />

          {/* ── Ripple rings emanating from center ── */}
          <div className="absolute pointer-events-none" style={{ top: '38%', left: '50%', width: '280px', height: '280px', border: '1.5px solid rgba(251,191,36,0.22)', borderRadius: '50%', animation: 'ripple-out 5s ease-out infinite' }} />
          <div className="absolute pointer-events-none" style={{ top: '38%', left: '50%', width: '280px', height: '280px', border: '1.5px solid rgba(239,68,68,0.2)', borderRadius: '50%', animation: 'ripple-out 5s ease-out infinite 1.67s' }} />
          <div className="absolute pointer-events-none" style={{ top: '38%', left: '50%', width: '280px', height: '280px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '50%', animation: 'ripple-out 5s ease-out infinite 3.33s' }} />

          {/* ── Diagonal light streaks ── */}
          <div className="absolute top-1/4 -left-1/4 w-[150%] h-[25%] blur-[80px] opacity-[0.12]"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,220,100,0.5), rgba(255,255,255,0.3), transparent)', animation: 'drift-slow 28s linear infinite' }} />
          <div className="absolute bottom-1/4 -right-1/4 w-[150%] h-[20%] blur-[90px] opacity-[0.10]"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(251,146,60,0.4), rgba(255,255,255,0.2), transparent)', animation: 'drift-slow 36s linear infinite reverse' }} />

          {/* ── Fine grain texture overlay ── */}
          <div className="absolute inset-0 opacity-[0.025] mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundSize: '180px 180px' }} />
        </div>
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
        {showCard && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[1.35rem] sm:rounded-[2rem]">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-white/30" style={{ animation: 'ring-expand 1.3s ease-out 0.05s both' }} />
          </div>
        )}
         <button onClick={onClose} className="absolute top-2.5 right-2.5 sm:top-4 sm:right-4 z-30 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center group transition-all duration-200 hover:scale-110" style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(8px)' }} aria-label="Đóng">
           <X className="w-4 h-4 text-white/80 group-hover:text-white group-hover:rotate-90 transition-all duration-300" />
         </button>
         <div className="relative z-10 px-3 sm:px-5 md:px-8 pt-5 sm:pt-7 pb-5 sm:pb-7">
           <div className={cn('text-center mb-4 sm:mb-7', contentPhase >= 1 ? 'anim-title-reveal' : 'opacity-0')}>
             <div className="inline-flex max-w-[calc(100%-3rem)] items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 rounded-full mb-3 sm:mb-4 relative"
               style={{
                 background: 'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.18) 100%)',
                 backdropFilter: 'blur(24px) saturate(1.6)',
                 WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                 border: '1px solid rgba(255,255,255,0.5)',
                 boxShadow: '0 2px 16px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.75) inset, 0 -1px 0 rgba(0,0,0,0.1) inset',
                 borderRadius: '999px',
               }}>
               {/* top gloss strip */}
               <div className="absolute left-[8%] right-[8%] top-[3px] h-[38%] rounded-full pointer-events-none"
                 style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.5), rgba(255,255,255,0.08))', filter: 'blur(1px)' }} />
               <span className="text-white/95 text-sm leading-none relative" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)', zIndex: 1 }}>★</span>
               <span className="text-[8px] sm:text-[10px] md:text-[11px] font-black tracking-[0.12em] sm:tracking-[0.2em] uppercase leading-tight"
                 style={{ color: 'rgba(255,255,255,0.97)', textShadow: '0 1px 6px rgba(0,0,0,0.5)', position: 'relative', zIndex: 1 }}>
                 Bảng Vinh Danh Giảng Viên Xuất Sắc
               </span>
               <span className="text-white/95 text-sm leading-none relative" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)', zIndex: 1 }}>★</span>
             </div>
             <h1 className="text-[1.55rem] sm:text-[2rem] md:text-[2.4rem] font-black tracking-tight leading-none mb-2 text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]">VINH DANH NGÔI SAO ĐÀO TẠO</h1>
             <p className="text-[12px] sm:text-[15px] text-white/90 font-extrabold tracking-wide sm:tracking-widest drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">TẬN TÂM TRÊN TỪNG BÀI GIẢNG &nbsp;·&nbsp; TRUYỀN CẢM HỨNG MỖI NGÀY</p>
           </div>
          <div className={cn('flex items-end justify-center gap-1.5 sm:gap-3 md:gap-6 mt-6 sm:mt-8 md:mt-[40px] mb-6 sm:mb-7 md:mb-[30px] w-full px-0 sm:px-2', contentPhase >= 2 ? '' : 'opacity-0')}>
            {podium.map((teacher, idx) => {
              const isFirst = idx === 1
              const animCls = contentPhase >= 2 ? (isFirst ? 'anim-slide-center' : idx === 0 ? 'anim-slide-left' : 'anim-slide-right') : 'opacity-0'
              return <PodiumCard key={teacher.teacher_code} teacher={teacher} idx={idx} animCls={animCls} triggerAnimate={contentPhase >= 2} />
            })}
          </div>
           <div className={cn('transition-all duration-700', contentPhase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2')} style={{ transitionDelay: contentPhase >= 3 ? '0.6s' : '0s' }}>
             <div className="flex items-center justify-center mb-3 sm:mb-4">
               <div className="inline-flex items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 rounded-full relative"
                   style={{
                            background: 'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.18) 100%)',
                            backdropFilter: 'blur(24px) saturate(1.6)',
                            WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
                            border: '1px solid rgba(255,255,255,0.5)',
                            boxShadow: '0 2px 16px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.75) inset, 0 -1px 0 rgba(0,0,0,0.1) inset',
                            borderRadius: '999px',
                          }}>
                 {/* top gloss strip */}
                 <div className="absolute left-[8%] right-[8%] top-[3px] h-[38%] rounded-full pointer-events-none"
                   style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.5), rgba(255,255,255,0.08))', filter: 'blur(1px)' }} />
                 <span className="text-white/95 text-sm leading-none relative" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)', zIndex: 1 }}>★</span>
                 <span className="text-[8px] sm:text-[10px] md:text-[11px] font-black tracking-[0.12em] sm:tracking-[0.2em] uppercase leading-tight"
                   style={{ color: 'rgba(255,255,255,0.97)', textShadow: '0 1px 6px rgba(0,0,0,0.5)', position: 'relative', zIndex: 1 }}>
                   Tôn vinh những người đưa đò thầm lặng
                 </span>
                 <span className="text-white/95 text-sm leading-none relative" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)', zIndex: 1 }}>★</span>
               </div>
             </div>
           </div>
        </div>
      </div>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TeacherHonorsPopupProps { isOpen: boolean; onOpen?: () => void; onClose: () => void }

export function TeacherHonorsPopup({ isOpen, onOpen, onClose }: TeacherHonorsPopupProps) {
  const [mounted, setMounted] = useState(false)
  const [renderCard, setRenderCard] = useState(false)
  const [showCard, setShowCard] = useState(false)
  const [contentPhase, setContentPhase] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const animStateRef = useRef<'idle' | 'in' | 'out'>('idle')
  const onCloseRef = useRef(onClose)
  const triggerOpenRef = useRef<(() => void) | null>(null)
  const triggerCloseRef = useRef<(() => void) | null>(null)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { setMounted(true) }, [])

  const getTabRect = useCallback((): Rect | null => {
    const el = document.getElementById('tab-vinh-danh'); if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, [])

  const getCardRect = useCallback((): Rect | null => {
    const el = cardRef.current; if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [])

  const resizeCanvas = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    c.width = window.innerWidth; c.height = window.innerHeight
  }, [])

  const runOpen = useCallback((src: Rect, dst: Rect) => {
    const canvas = canvasRef.current; const overlay = overlayRef.current; if (!canvas) return
    resizeCanvas(); const ctx = canvas.getContext('2d')!
    const TOTAL = 820; const PHASE1_END = 0.48; let start = -1; particlesRef.current = []
    const tick = (now: number) => {
      if (start < 0) start = now; const raw = Math.min((now - start) / TOTAL, 1)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (overlay) overlay.style.opacity = String(E.outCubic(Math.min(raw * 2, 1)) * 0.72)
      if (raw <= PHASE1_END) {
        const p = raw / PHASE1_END; const topT = E.outExpo(Math.min(p * 1.55, 1)); const botT = E.outCubic(Math.min(p * 0.7, 1)); const shapeAlpha = Math.min(p * 3, 1)
        paintGenie(ctx, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h, topT, botT, shapeAlpha, false)
        if (p > 0.3 && p < 0.85 && Math.random() > 0.55) particlesRef.current.push(...spawnParticles(dst.x + dst.w / 2, src.y + (dst.y - src.y) * topT * 0.5, 3))
      }
      if (raw > PHASE1_END * 0.9 && !showCard) { setShowCard(true); setContentPhase(3) }
      particlesRef.current = particlesRef.current.filter(p => p.opacity > 0.02)
      for (const pt of particlesRef.current) {
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.12; pt.opacity -= pt.decay
        ctx.globalAlpha = pt.opacity; ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
      }
      if (raw < 1 || particlesRef.current.length > 0) rafRef.current = requestAnimationFrame(tick)
      else { canvas.style.opacity = '0'; animStateRef.current = 'idle' }
    }
    canvas.style.opacity = '1'; canvas.style.pointerEvents = 'none'; rafRef.current = requestAnimationFrame(tick)
  }, [resizeCanvas, showCard])

  const runClose = useCallback((src: Rect, dst: Rect) => {
    const canvas = canvasRef.current; const overlay = overlayRef.current; if (!canvas) return
    resizeCanvas(); const ctx = canvas.getContext('2d')!
    const TOTAL = 580; let start = -1; setShowCard(false); setContentPhase(0); canvas.style.opacity = '1'
    const tick = (now: number) => {
      if (start < 0) start = now; const raw = Math.min((now - start) / TOTAL, 1)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (overlay) overlay.style.opacity = String(Math.max(0, 0.72 * (1 - E.outCubic(raw))))
      const botT = 1 - E.outExpo(1 - raw); const topT = E.inOutCubic(raw * 0.82); const shapeAlpha = Math.max(0, 1 - raw * 1.3)
      paintGenie(ctx, src.x + src.w / 2, src.y + src.h / 2, src.w, src.h, dst.x, dst.y, dst.w, dst.h, topT, botT, shapeAlpha, true)
      if (raw < 1) rafRef.current = requestAnimationFrame(tick)
      else { canvas.style.opacity = '0'; animStateRef.current = 'idle'; setRenderCard(false); onCloseRef.current() }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [resizeCanvas])

  const triggerOpen = useCallback(() => {
    if (animStateRef.current === 'in') return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tabRect = getTabRect()
    if (tabRect) {
      animStateRef.current = 'in'; setShowCard(false); setContentPhase(0); setRenderCard(true)
      requestAnimationFrame(() => { requestAnimationFrame(() => { const cardRect = getCardRect(); if (cardRect) runOpen(tabRect, cardRect) }) })
    } else {
      animStateRef.current = 'in'; setRenderCard(true); setTimeout(() => setShowCard(true), 10); setTimeout(() => setContentPhase(3), 440)
    }
  }, [getTabRect, getCardRect, runOpen])

  const triggerClose = useCallback(() => {
    if (animStateRef.current === 'out') return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const tabRect = getTabRect(); const cardRect = getCardRect()
    if (tabRect && cardRect) { animStateRef.current = 'out'; runClose({ x: cardRect.x, y: cardRect.y, w: cardRect.w, h: cardRect.h }, tabRect) }
    else { animStateRef.current = 'out'; setShowCard(false); setContentPhase(0); setTimeout(() => { setRenderCard(false); onCloseRef.current() }, 200) }
  }, [getTabRect, getCardRect, runClose])

  useEffect(() => { triggerOpenRef.current = triggerOpen; triggerCloseRef.current = triggerClose }, [triggerOpen, triggerClose])
  useEffect(() => { if (isOpen) triggerOpenRef.current?.(); else if (renderCard) triggerCloseRef.current?.() }, [isOpen, renderCard])
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const { data } = useSWR<TopTeachersResponse>('/api/truyenthong/top-teachers', fetcher, { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 300_000 })
  const teachers = data?.success && Array.isArray(data.data) ? data.data : []
  const podium = [{ ...teachers[1], rank: 2 }, { ...teachers[0], rank: 1 }, { ...teachers[2], rank: 3 }].map((t, i) => ({
    ...t, teacher_code: t?.teacher_code || `t${i}`, full_name: t?.full_name || ['Giáo viên Xuất Sắc', 'Ngôi Sao Đào Tạo', 'Nhà Giáo Tận Tâm'][i], center: t?.center || ['MindX HCM', 'MindX HN', 'MindX ĐN'][i], total_score: t?.total_score || [9.8, 9.5, 9.2][i], avatar_url: t?.avatar_url || null,
  }))

  if (!mounted) return null

  return createPortal(
    <>
      <canvas ref={canvasRef} className="fixed inset-0 z-[60] pointer-events-none" style={{ opacity: 0, transition: 'opacity 0.15s' }} aria-hidden />
      {renderCard && <div ref={overlayRef} className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm" style={{ opacity: 0 }} onClick={triggerClose} />}
      {renderCard && <PopupUI cardRef={cardRef} showCard={showCard} contentPhase={contentPhase} podium={podium} onClose={triggerClose} activeConfetti={showCard && contentPhase >= 3} />}
    </>,
    document.body
  )
}

export default TeacherHonorsPopup
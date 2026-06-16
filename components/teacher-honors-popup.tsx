'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Crown, Star, Sparkles, Trophy, Medal } from 'lucide-react'
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

// ─── Easing ──────────────────────────────────────────────────────────────────

const E = {
  outExpo:   (t: number) => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
  outCubic:  (t: number) => 1 - (1 - t) ** 3,
  outQuart:  (t: number) => 1 - (1 - t) ** 4,
  inQuart:   (t: number) => t ** 4,
  inOutCubic:(t: number) => t < .5 ? 4*t**3 : 1-((-2*t+2)**3)/2,
  // elastic overshoot — Apple-style spring
  outElastic:(t: number) => {
    if (t <= 0) return 0; if (t >= 1) return 1
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1
  },
}

// ─── Canvas Genie Painter ─────────────────────────────────────────────────────
//
// Draws the "magic lamp" deformation directly on a full-screen canvas.
// Shape is a quadrilateral with bezier-curved left/right sides creating the
// characteristic "waist pinch" of the macOS Genie Effect.
//
// All coords in viewport px.

function paintGenie(
  ctx: CanvasRenderingContext2D,
  // source rect  (tab)
  sx: number, sy: number, sw: number, sh: number,
  // target rect  (final popup)
  tx: number, ty: number, tw: number, th: number,
  // progress [0,1] for top/bottom independently
  topT: number, botT: number,
  // fill color for the shape
  color: string,
) {
  // Interpolate corners
  const lerpX = (a: number, b: number, t: number) => a + (b - a) * t
  const lerpY = (a: number, b: number, t: number) => a + (b - a) * t

  // Source corners
  const stl = { x: sx - sw / 2, y: sy - sh / 2 }
  const str = { x: sx + sw / 2, y: sy - sh / 2 }
  const sbl = { x: sx - sw / 2, y: sy + sh / 2 }
  const sbr = { x: sx + sw / 2, y: sy + sh / 2 }

  // Target corners
  const ttl = { x: tx,      y: ty }
  const ttr = { x: tx + tw, y: ty }
  const tbl = { x: tx,      y: ty + th }
  const tbr = { x: tx + tw, y: ty + th }

  const TL = { x: lerpX(stl.x, ttl.x, topT), y: lerpY(stl.y, ttl.y, topT) }
  const TR = { x: lerpX(str.x, ttr.x, topT), y: lerpY(str.y, ttr.y, topT) }
  const BL = { x: lerpX(sbl.x, tbl.x, botT), y: lerpY(sbl.y, tbl.y, botT) }
  const BR = { x: lerpX(sbr.x, tbr.x, botT), y: lerpY(sbr.y, tbr.y, botT) }

  // "Waist" control points — the key to Genie's organic look.
  // Left side: cubic bezier from TL → BL with control points that pinch inward.
  // Right side: cubic bezier from TR → BR with control points that pinch inward.
  // Pinch magnitude is highest when top and bottom are most misaligned.
  const pinchFactor = Math.abs(topT - botT)
  const pinchPx = pinchFactor * Math.min(tw, th) * 0.55 * Math.sin(Math.PI * Math.min(topT, botT + 0.1))

  // Control points for left side
  const lcpT = { x: TL.x + pinchPx, y: TL.y + (BL.y - TL.y) * 0.35 }
  const lcpB = { x: BL.x + pinchPx, y: TL.y + (BL.y - TL.y) * 0.65 }

  // Control points for right side
  const rcpT = { x: TR.x - pinchPx, y: TR.y + (BR.y - TR.y) * 0.35 }
  const rcpB = { x: BR.x - pinchPx, y: TR.y + (BR.y - TR.y) * 0.65 }

  ctx.beginPath()
  ctx.moveTo(TL.x, TL.y)
  ctx.lineTo(TR.x, TR.y)
  ctx.bezierCurveTo(rcpT.x, rcpT.y, rcpB.x, rcpB.y, BR.x, BR.y)
  ctx.lineTo(BL.x, BL.y)
  ctx.bezierCurveTo(lcpB.x, lcpB.y, lcpT.x, lcpT.y, TL.x, TL.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

// ─── Particle system ─────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number
  size: number; opacity: number; decay: number; color: string
}

function spawnParticles(cx: number, cy: number, count: number): Particle[] {
  const colors = ['#fbbf24','#f59e0b','#fcd34d','#fef3c7','#ffffff','#fde68a']
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

// ─── 3D Tilt Card ─────────────────────────────────────────────────────────────

interface PodiumCardProps {
  teacher: { teacher_code: string; full_name: string; center: string; total_score: number; avatar_url: string | null; rank: number }
  idx: number
  animCls: string
}

function PodiumCard({ teacher, idx, animCls }: PodiumCardProps) {
  const cardEl = useRef<HTMLDivElement>(null)
  const glowEl = useRef<HTMLDivElement>(null)
  const rafTilt = useRef<number | null>(null)
  const targetTilt = useRef({ x: 0, y: 0 })
  const currentTilt = useRef({ x: 0, y: 0 })
  const sparkleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([])
  const sparkleId = useRef(0)

  const isFirst = idx === 1

  const configs = [
    // rank 2 — lab(33.7174 55.8993 41.0293)
    { h: 'h-[288px]', w: 'w-[192px]', bg: 'linear-gradient(to right bottom, lab(33.7174 55.8993 41.0293) 0%, lab(27 46 34) 100%)', border: 'border-red-900/20', badgeBg: 'lab(22 38 28)', shadow: '0 16px 40px -8px rgba(110,26,10,0.5)' },
    // rank 1 — darkest
    { h: 'h-[352px]', w: 'w-[224px]', bg: 'linear-gradient(to right bottom, #6e1a0a 0%, #620000 100%)', border: 'border-red-900/30', badgeBg: '#4a0000', shadow: '0 24px 55px -8px rgba(98,0,0,0.65), 0 0 28px -4px rgba(98,0,0,0.2)' },
    // rank 3 — lab gradient gốc
    { h: 'h-[256px]', w: 'w-[178px]', bg: 'linear-gradient(to right bottom, lab(48.4493 77.4328 61.5452) 0%, lab(40.4273 67.2623 53.7441) 100%)', border: 'border-red-700/15', badgeBg: 'lab(33.7174 55.8993 41.0293)', shadow: '0 14px 36px -8px rgba(168,61,40,0.42)' },
  ]
  const cfg = configs[idx]
  const slogans = ['Kiên trì · Không bỏ cuộc', 'Chấp nhận · Làm lại · Hoàn thiện', 'Cải thiện · Tốt hơn mỗi ngày']

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  const animateTilt = useCallback(() => {
    currentTilt.current.x = lerp(currentTilt.current.x, targetTilt.current.x, 0.12)
    currentTilt.current.y = lerp(currentTilt.current.y, targetTilt.current.y, 0.12)
    const { x, y } = currentTilt.current
    if (cardEl.current) {
      cardEl.current.style.transform = `perspective(900px) rotateX(${x}deg) rotateY(${y}deg) scale3d(1.04,1.04,1.04)`
    }
    if (glowEl.current) {
      const gx = 50 + y * 3
      const gy = 50 - x * 3
      glowEl.current.style.background = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.12) 0%, transparent 65%)`
    }
    if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) {
      rafTilt.current = requestAnimationFrame(animateTilt)
    } else {
      rafTilt.current = null
    }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardEl.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width  - 0.5  // -0.5 to 0.5
    const ny = (e.clientY - r.top)  / r.height - 0.5
    targetTilt.current = { x: -ny * 14, y: nx * 14 }
    if (!rafTilt.current) rafTilt.current = requestAnimationFrame(animateTilt)

    // Spawn sparkle at cursor position
    if (sparkleTimeout.current) return
    sparkleTimeout.current = setTimeout(() => { sparkleTimeout.current = null }, 120)
    const id = ++sparkleId.current
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
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
      className={cn('relative flex-shrink-0 cursor-pointer', cfg.h, cfg.w, animCls, isFirst ? 'z-10' : 'z-0')}
      style={{ perspective: '900px' }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div
        ref={cardEl}
        className={cn(
          'relative w-full h-full flex flex-col items-center rounded-[1.75rem] overflow-hidden p-4 border',
          cfg.border,
        )}
        style={{ background: cfg.bg, boxShadow: cfg.shadow, transformStyle: 'preserve-3d', willChange: 'transform' }}
      >
        {/* Inner glow layer that moves with tilt */}
        <div ref={glowEl} className="absolute inset-0 pointer-events-none rounded-[1.75rem] transition-none z-10" />

        {/* Top shimmer line */}
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

        {/* Rank badge */}
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[10px] font-black text-white z-20 tracking-wider shadow-md"
          style={{ background: cfg.badgeBg }}>
          #{teacher.rank}
        </div>

        {/* Score badge */}
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-xl z-20 border border-white/15 shadow-md">
          <Star className="w-2.5 h-2.5 fill-amber-300 text-amber-300" />
          <span className="text-[10px] text-white font-black tabular-nums">{Number(teacher.total_score).toFixed(1)}</span>
        </div>

        {/* Crown */}
        {isFirst && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 pointer-events-none" style={{ animation: 'crown-bob 2.8s ease-in-out infinite' }}>
            <Crown className="w-7 h-7 text-red-200 fill-red-200/40 drop-shadow-[0_2px_8px_rgba(255,200,200,0.6)]" />
          </div>
        )}

        {/* Avatar */}
        <div className={cn(
          'relative shrink-0 rounded-full shadow-xl overflow-hidden flex items-center justify-center z-10',
          isFirst
            ? 'w-[88px] h-[88px] mt-9 border-[3px] border-white/60'
            : 'w-[62px] h-[62px] mt-5 border-2 border-white/50'
        )}>
          {teacher.avatar_url
            ? <img src={teacher.avatar_url} alt={teacher.full_name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center bg-white/15">
                <span className={cn('font-black text-white', isFirst ? 'text-2xl' : 'text-lg')}>
                  {initials(teacher.full_name)}
                </span>
              </div>
          }
          {isFirst && <div className="absolute inset-0 rounded-full ring-2 ring-red-200/50 ring-offset-1 ring-offset-transparent animate-pulse" />}
        </div>

        {/* Info */}
        <div className="flex-1 flex flex-col items-center justify-end w-full text-center mt-3 pb-1 z-10">
          <h4 className={cn('font-black text-white leading-snug drop-shadow mb-0.5 line-clamp-2', isFirst ? 'text-[15px]' : 'text-[13px]')}>
            {teacher.full_name}
          </h4>
          <p className={cn('text-white/65 font-semibold mb-2.5 line-clamp-1', isFirst ? 'text-xs' : 'text-[11px]')}>
            {teacher.center}
          </p>
          <div className="w-full bg-black/30 backdrop-blur-sm py-1.5 px-2 rounded-xl border border-white/10">
            <span className="text-[9px] font-black text-white/80 tracking-[0.12em] uppercase">
              {slogans[idx]}
            </span>
          </div>
        </div>

        {/* Hover sparkles */}
        {sparkles.map(s => (
          <div key={s.id} className="absolute pointer-events-none z-30"
            style={{ left: s.x, top: s.y, animation: 'sparkle-pop 0.7s ease-out forwards' }}>
            <Star className="w-3 h-3 text-white fill-white/80 -translate-x-1/2 -translate-y-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Popup UI Shell ──────────────────────────────────────────────────────────

interface PopupUIProps {
  cardRef: React.RefObject<HTMLDivElement | null>
  showCard: boolean
  contentPhase: number
  podium: { teacher_code: string; full_name: string; center: string; total_score: number; avatar_url: string | null; rank: number }[]
  onClose: () => void
}

function PopupUI({ cardRef, showCard, contentPhase, podium, onClose }: PopupUIProps) {
  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center p-4 pointer-events-none select-none">
      <style>{`
        @keyframes genie-card-in {
          0%   { opacity:0; transform:scale(0.82) translateY(22px); filter:blur(10px); }
          55%  { opacity:1; transform:scale(1.035) translateY(-5px); filter:blur(0); }
          78%  { transform:scale(0.988) translateY(1px); }
          100% { opacity:1; transform:scale(1) translateY(0); }
        }
        @keyframes shimmer-sweep {
          0%   { transform:translateX(-120%) skewX(-18deg); }
          100% { transform:translateX(320%) skewX(-18deg); }
        }
        @keyframes ring-expand {
          0%   { transform:scale(0.2); opacity:1; }
          100% { transform:scale(3.2); opacity:0; }
        }
        @keyframes crown-bob {
          0%,100% { transform:translateY(0) rotate(-4deg) scale(1); }
          50%     { transform:translateY(-6px) rotate(4deg) scale(1.05); }
        }
        @keyframes card-slide-left {
          from { opacity:0; transform:translateX(-40px) rotate(-9deg) scale(0.86) translateY(10px); }
          to   { opacity:1; transform:translateX(0) rotate(-2.5deg) scale(1); }
        }
        @keyframes card-slide-center {
          from { opacity:0; transform:translateY(50px) scale(0.8); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes card-slide-right {
          from { opacity:0; transform:translateX(40px) rotate(9deg) scale(0.86) translateY(10px); }
          to   { opacity:1; transform:translateX(0) rotate(2.5deg) scale(1); }
        }
        @keyframes title-reveal {
          from { opacity:0; transform:translateY(16px); filter:blur(4px); }
          to   { opacity:1; transform:translateY(0);    filter:blur(0); }
        }
        @keyframes star-pop {
          0%   { transform:scale(0) rotate(-45deg); opacity:0; }
          65%  { transform:scale(1.4) rotate(12deg); opacity:1; }
          100% { transform:scale(1) rotate(0); opacity:1; }
        }
        @keyframes sparkle-pop {
          0%   { transform:translate(-50%,-50%) scale(0) rotate(0deg);   opacity:1; }
          50%  { transform:translate(-50%,-80%) scale(1.4) rotate(180deg); opacity:0.9; }
          100% { transform:translate(-50%,-120%) scale(0) rotate(360deg); opacity:0; }
        }
        @keyframes float-orb {
          0%,100% { transform:translateY(0) translateX(0) scale(1); opacity:0.35; }
          33%     { transform:translateY(-18px) translateX(8px) scale(1.08); opacity:0.5; }
          66%     { transform:translateY(-8px) translateX(-10px) scale(0.95); opacity:0.3; }
        }
        .anim-card-in      { animation: genie-card-in    0.75s cubic-bezier(0.34,1.15,0.64,1) both; }
        .anim-slide-left   { animation: card-slide-left   0.7s cubic-bezier(0.34,1.25,0.64,1) both; }
        .anim-slide-center { animation: card-slide-center 0.8s cubic-bezier(0.34,1.35,0.64,1) both; }
        .anim-slide-right  { animation: card-slide-right  0.7s cubic-bezier(0.34,1.25,0.64,1) both; }
        .anim-title-reveal { animation: title-reveal 0.55s cubic-bezier(0.34,1.2,0.64,1) both; }
      `}</style>

      <div
        ref={cardRef}
        className={cn(
          'relative w-full max-w-[820px] pointer-events-auto overflow-hidden rounded-[2rem]',
          showCard ? 'anim-card-in' : 'opacity-0 pointer-events-none',
        )}
        style={{
          background: 'linear-gradient(150deg, #fffdf7 0%, #fef9ed 35%, #fdf4e0 65%, #fef8ea 100%)',
          boxShadow: '0 32px 80px -16px rgba(0,0,0,0.22), 0 0 0 1px rgba(251,191,36,0.2), inset 0 1px 0 rgba(255,255,255,0.95)',
        }}
      >
        {/* Ambient background orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[2rem]">
          <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)', animation: 'float-orb 7s ease-in-out infinite' }} />
          <div className="absolute -bottom-16 -right-16 w-64 h-64 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.09) 0%, transparent 70%)', animation: 'float-orb 9s ease-in-out infinite 2s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-48 rounded-full"
            style={{ background: 'radial-gradient(ellipse, rgba(253,230,138,0.1) 0%, transparent 70%)', animation: 'float-orb 11s ease-in-out infinite 4s' }} />
        </div>

        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />

        {/* Reveal rings */}
        {showCard && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[2rem]">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-amber-400/25"
              style={{ animation: 'ring-expand 1.3s ease-out 0.05s both' }} />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-yellow-300/20"
              style={{ animation: 'ring-expand 1.5s ease-out 0.2s both' }} />
          </div>
        )}

        {/* Shimmer */}
        {showCard && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[2rem]">
            <div className="absolute inset-y-0 w-2/5 bg-gradient-to-r from-transparent via-white/50 to-transparent"
              style={{ animation: 'shimmer-sweep 1.2s ease-out 0.1s both' }} />
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-30 w-9 h-9 rounded-full flex items-center justify-center group transition-all duration-200 hover:scale-110"
          style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', backdropFilter: 'blur(8px)' }}
          aria-label="Đóng"
        >
          <X className="w-4 h-4 text-amber-800/50 group-hover:text-amber-900 group-hover:rotate-90 transition-all duration-300" />
        </button>

        <div className="relative z-10 px-8 pt-7 pb-7">

          {/* ── HEADER ── */}
          <div className={cn('text-center mb-7', contentPhase >= 1 ? 'anim-title-reveal' : 'opacity-0')}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-4"
              style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)' }}>
              <Trophy className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[11px] font-black tracking-[0.2em] text-amber-700 uppercase">
                Bảng Vinh Danh Giảng Viên Xuất Sắc
              </span>
              <Trophy className="w-3.5 h-3.5 text-amber-600" />
            </div>

            <h1 className="text-[2.4rem] font-black tracking-tight leading-none mb-2"
              style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 35%, #d97706 65%, #f59e0b 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              VINH DANH NGÔI SAO ĐÀO TẠO
            </h1>
            <p className="text-sm text-amber-800/55 font-medium tracking-wider">
              Tận tâm trên từng bài giảng &nbsp;·&nbsp; Truyền cảm hứng mỗi ngày
            </p>
          </div>

          {/* ── PODIUM ── */}
          <div className={cn(
            'flex items-end justify-center gap-4 mb-7',
            contentPhase >= 2 ? '' : 'opacity-0'
          )}>
            {podium.map((teacher, idx) => {
              const isFirst = idx === 1
              const animCls = contentPhase >= 2
                ? (isFirst ? 'anim-slide-center' : idx === 0 ? 'anim-slide-left' : 'anim-slide-right')
                : 'opacity-0'
              return <PodiumCard key={teacher.teacher_code} teacher={teacher} idx={idx} animCls={animCls} />
            })}
          </div>

          {/* ── QUOTE ── */}
          <div className={cn('transition-all duration-700', contentPhase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2')}>
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(217,119,6,0.35))' }} />
              <Sparkles className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, rgba(217,119,6,0.35))' }} />
            </div>
            <p className="text-center text-[13px] text-amber-900/50 font-medium italic mt-3 leading-relaxed">
              "Tôn vinh những người đưa đò thầm lặng — truyền tri thức, khơi nguồn cảm hứng, kiến tạo tương lai"
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TeacherHonorsPopupProps {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
}

export function TeacherHonorsPopup({ isOpen, onOpen, onClose }: TeacherHonorsPopupProps) {
  const [mounted, setMounted]         = useState(false)
  const [renderCard, setRenderCard]   = useState(false)   // card in DOM
  const [showCard, setShowCard]       = useState(false)   // card visible (after genie)
  const [contentPhase, setContentPhase] = useState(0)     // 0=hidden 1=title 2=podium 3=quote

  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const overlayRef  = useRef<HTMLDivElement>(null)
  const cardRef     = useRef<HTMLDivElement>(null)
  const rafRef      = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const animStateRef = useRef<'idle' | 'in' | 'out'>('idle')
  const onCloseRef   = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => { setMounted(true) }, [])

  const getTabRect = useCallback((): Rect | null => {
    const el = document.getElementById('tab-vinh-danh')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, [])

  const getCardRect = useCallback((): Rect | null => {
    const el = cardRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [])

  // ── Canvas setup ────────────────────────────────────────────────────────────

  const resizeCanvas = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.width  = window.innerWidth
    c.height = window.innerHeight
  }, [])

  // ── OPEN animation ──────────────────────────────────────────────────────────
  //
  // Phase 1 (0–0.45): Genie shape stretches from tab to full popup area
  // Phase 2 (0.45–1): Canvas fades out, real card snaps in with elastic scale

  const runOpen = useCallback((src: Rect, dst: Rect) => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas) return

    resizeCanvas()
    const ctx = canvas.getContext('2d')!

    const TOTAL      = 820
    const PHASE1_END = 0.48  // genie shape phase
    // Phase 2 handled by CSS on the card

    let start = -1
    particlesRef.current = []

    const tick = (now: number) => {
      if (start < 0) start = now
      const raw = Math.min((now - start) / TOTAL, 1)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (overlay) overlay.style.opacity = String(E.outCubic(Math.min(raw * 2, 1)) * 0.72)

      if (raw <= PHASE1_END) {
        // Normalise within phase 1
        const p = raw / PHASE1_END  // 0→1 within genie phase

        // Top edge races ahead, bottom lags — the Genie signature
        const topT = E.outExpo(Math.min(p * 1.55, 1))
        const botT = E.outCubic(Math.min(p * 0.7, 1))

        // Opacity of the shape: fade in fast then hold
        const shapeAlpha = Math.min(p * 3, 1)

        paintGenie(
          ctx,
          src.x, src.y, src.w, src.h,
          dst.x, dst.y, dst.w, dst.h,
          topT, botT,
          `rgba(255,250,235,${shapeAlpha})`,
        )

        // Golden shimmer overlay on the shape (sweeping highlight)
        const shimmerX = dst.x + dst.w * (p * 1.4 - 0.2)
        const shimmerGrad = ctx.createLinearGradient(shimmerX - 60, 0, shimmerX + 60, 0)
        shimmerGrad.addColorStop(0,   'rgba(251,191,36,0)')
        shimmerGrad.addColorStop(0.5, `rgba(251,191,36,${0.18 * Math.sin(Math.PI * p)})`)
        shimmerGrad.addColorStop(1,   'rgba(251,191,36,0)')
        ctx.fillStyle = shimmerGrad
        ctx.fill() // reuses last path

        // Spawn particles at midpoint of genie shape
        if (p > 0.3 && p < 0.85 && Math.random() > 0.55) {
          const midY = src.y + (dst.y - src.y) * topT * 0.5
          particlesRef.current.push(...spawnParticles(dst.x + dst.w / 2, midY, 3))
        }

      } else {
        // Phase 2 — genie done, just clear + particles
        // Trigger card appearance once (exactly at transition)
        if (!showCard) {
          setShowCard(true)
          // Stagger content phases
          setTimeout(() => setContentPhase(1), 80)
          setTimeout(() => setContentPhase(2), 240)
          setTimeout(() => setContentPhase(3), 440)
        }
      }

      // Always paint particles
      particlesRef.current = particlesRef.current.filter(p => p.opacity > 0.02)
      for (const pt of particlesRef.current) {
        pt.x += pt.vx; pt.y += pt.vy
        pt.vy += 0.12  // gravity
        pt.opacity -= pt.decay
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2)
        ctx.fillStyle = pt.color.replace(')', `,${pt.opacity})`).replace('rgb', 'rgba').replace('##', '#')
        // simpler approach:
        ctx.globalAlpha = pt.opacity
        ctx.fillStyle   = pt.color
        ctx.fill()
        ctx.globalAlpha = 1
      }

      if (raw < 1 || particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        // All done — hide canvas
        canvas.style.opacity = '0'
        animStateRef.current = 'idle'
        setTimeout(() => setContentPhase(3), 0)
      }
    }

    canvas.style.opacity = '1'
    canvas.style.pointerEvents = 'none'
    rafRef.current = requestAnimationFrame(tick)
  }, [resizeCanvas, showCard])

  // ── CLOSE animation ──────────────────────────────────────────────────────────

  const runClose = useCallback((src: Rect, dst: Rect) => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas) return

    resizeCanvas()
    const ctx = canvas.getContext('2d')!

    const TOTAL = 580
    let start = -1

    // Immediately hide card, show canvas shape
    setShowCard(false)
    setContentPhase(0)
    canvas.style.opacity = '1'

    const tick = (now: number) => {
      if (start < 0) start = now
      const raw = Math.min((now - start) / TOTAL, 1)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (overlay) overlay.style.opacity = String(Math.max(0, 0.72 * (1 - E.outCubic(raw))))

      // Bottom collapses first (inQuart = fast acceleration)
      // Top follows (inOutCubic = gradual)
      const botT = 1 - E.outExpo(1 - raw)   // fast: near easeInExpo
      const topT = E.inOutCubic(raw * 0.82)  // slow

      const shapeAlpha = Math.max(0, 1 - raw * 1.3)

      // src = popup rect (full), dst = tab rect
      // We reuse paintGenie but swap src/dst and invert progress
      paintGenie(
        ctx,
        src.x + src.w / 2, src.y + src.h / 2, src.w, src.h,  // popup as "source" at t=0
        dst.x, dst.y, dst.w, dst.h,                             // tab as target
        topT, botT,
        `rgba(255,250,235,${shapeAlpha})`,
      )

      // Shimmer sweeping backward
      const shimmerX = (src.x + src.w / 2) - src.w * raw * 0.6
      const shimmerGrad = ctx.createLinearGradient(shimmerX - 40, 0, shimmerX + 40, 0)
      shimmerGrad.addColorStop(0,   'rgba(251,191,36,0)')
      shimmerGrad.addColorStop(0.5, `rgba(251,191,36,${0.1 * Math.sin(Math.PI * raw)})`)
      shimmerGrad.addColorStop(1,   'rgba(251,191,36,0)')
      ctx.fillStyle = shimmerGrad
      ctx.fill()

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        canvas.style.opacity = '0'
        animStateRef.current = 'idle'
        setRenderCard(false)
        onCloseRef.current()
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [resizeCanvas])

  // ── Trigger open ──────────────────────────────────────────────────────────

  const triggerOpen = useCallback(() => {
    if (animStateRef.current === 'in') return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tabRect = getTabRect()
    if (!tabRect) return

    animStateRef.current = 'in'
    setShowCard(false)
    setContentPhase(0)
    setRenderCard(true)  // mount card to DOM (invisible)

    // Wait one frame for card to mount + get its rect
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cardRect = getCardRect()
        if (!cardRect) return
        runOpen(tabRect, cardRect)
      })
    })
  }, [getTabRect, getCardRect, runOpen])

  // ── Trigger close ─────────────────────────────────────────────────────────

  const triggerClose = useCallback(() => {
    if (animStateRef.current === 'out') return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tabRect = getTabRect()
    const cardRect = getCardRect()
    if (!tabRect || !cardRect) {
      setRenderCard(false)
      onCloseRef.current()
      return
    }

    animStateRef.current = 'out'
    runClose(
      { x: cardRect.x, y: cardRect.y, w: cardRect.w, h: cardRect.h },
      tabRect,
    )
  }, [getTabRect, getCardRect, runClose])

  // ── isOpen sync ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      triggerOpen()
    } else if (renderCard) {
      triggerClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data } = useSWR<TopTeachersResponse>('/api/truyenthong/top-teachers', fetcher, {
    revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 300_000,
  })
  const teachers = data?.success && Array.isArray(data.data) ? data.data : []

  const podium = [
    { ...teachers[1], rank: 2 },
    { ...teachers[0], rank: 1 },
    { ...teachers[2], rank: 3 },
  ].map((t, i) => ({
    ...t,
    teacher_code: t?.teacher_code || `t${i}`,
    full_name:    t?.full_name    || ['Giáo viên Xuất Sắc', 'Ngôi Sao Đào Tạo', 'Nhà Giáo Tận Tâm'][i],
    center:       t?.center       || ['MindX HCM', 'MindX HN', 'MindX ĐN'][i],
    total_score:  t?.total_score  || [9.8, 9.5, 9.2][i],
    avatar_url:   t?.avatar_url   || null,
  }))

  if (!mounted) return null

  return createPortal(
    <>
      {/* ── Full-screen canvas for Genie animation ── */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-[60] pointer-events-none"
        style={{ opacity: 0, transition: 'opacity 0.15s' }}
        aria-hidden
      />

      {/* ── Backdrop ── */}
      {renderCard && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-md"
          style={{ opacity: 0 }}
          onClick={triggerClose}
        />
      )}

      {/* ── Popup card ── */}
      {renderCard && <PopupUI
        cardRef={cardRef}
        showCard={showCard}
        contentPhase={contentPhase}
        podium={podium}
        onClose={triggerClose}
      />}
    </>,
    document.body
  )
}

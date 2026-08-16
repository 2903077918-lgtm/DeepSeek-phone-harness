// S7 deep-space outro / global-network-orbit (791-930, 140f): deep space Earth
// arc, a phone node and a computer node that appear and connect with a gold
// pulsing line, 4G/5G signal rings ripple out, then the wordmark + bilingual
// tagline + repo lock with a single gold sweep. Riser → impact → sparkle beat.
// Final set holds ≥30f. All node/star positions are deterministic (fixed seed).
// Local frame = global - 791 (0..139).
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing, Img, staticFile } from 'remotion';
import { mulberry32 } from '../util/rand';
import { PhoneShell, PHONE_W, PHONE_H } from './PhoneFrame';

const SANS = 'Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';
const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.85)';
const INK = '#F2F2F2';
const CN = 'rgba(230,214,168,0.95)'; // warm gold-tinted secondary, on-token
const DIM = 'rgba(242,242,242,0.62)';
const EASE = Easing.bezier(0.3, 0, 0.2, 1);

// --- deterministic starfield (fixed seed) ---
const rng = mulberry32(202607);
const STARS = Array.from({ length: 90 }, () => ({
  x: Math.round(rng() * 1920),
  y: Math.round(rng() * 1080),
  r: 0.6 + rng() * 1.7,
  a: 0.22 + rng() * 0.5,
  tw: rng() * Math.PI * 2,
}));

// phone node centre (screen px) and computer node centre
const PHONE_CX = 420;
const PHONE_CY = 470;
const COMP_CX = 1510;
const COMP_CY = 470;
// the desk connection points: near the bottom edge of each node so the gold
// line visibly emanates from the phone and lands on the computer
const L1 = { x: PHONE_CX + 30, y: PHONE_CY + 60 };
const L2 = { x: COMP_CX, y: COMP_CY - 40 };

export const SceneOutro: React.FC = () => {
  const frame = useCurrentFrame(); // local 0..139

  // --- establishing: starfield + earth + nodes ---
  const spIn = interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const phoneOn = interpolate(frame, [8, 18], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const phoneY = interpolate(frame, [8, 20], [-60, 0], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const compOn = interpolate(frame, [16, 28], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const compY = interpolate(frame, [16, 30], [70, 0], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // line draws + pulse travels
  const lineDraw = interpolate(frame, [28, 50], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pulseProg = interpolate(frame, [52, 140], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // pulse fractional position that wraps (slow flow)
  const flow = ((Math.sin((pulseProg) * Math.PI * 4) + 1) / 2) * lineDraw;

  // 4G/5G ring ripples from the phone
  const ring1 = interpolate(frame, [50, 82], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring2 = interpolate(frame, [60, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // wordmark + taglines + repo: all set by frame ~98 so 100..139 = 30f hold
  const wmIn = interpolate(frame, [68, 84], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const wmSweep = interpolate(frame, [70, 86], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tagIn = interpolate(frame, [84, 96], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const repoIn = interpolate(frame, [94, 104], [0, 1], { easing: EASE, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // gentle breathing after everything settles (hold stays readable)
  const breathe = 1 + 0.012 * Math.sin(((frame - 108) / 34) * Math.PI * 2);

  // gold connecting line (a gentle quadratic curve between the two nodes)
  const linePath = `M ${L1.x} ${L1.y} Q ${(L1.x + L2.x) / 2} ${L2.y + 40} ${L2.x} ${L2.y}`;
  const dash = 8;
  const gap = 26;

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(130% 100% at 50% 0%, #0d1226 0%, #07090f 58%, #05060a 100%)' }}>
      {/* starfield */}
      <div style={{ position: 'absolute', inset: 0, opacity: spIn, pointerEvents: 'none' }}>
        {STARS.map((s, i) => {
          const twinkle = 0.6 + 0.4 * Math.sin(s.tw + frame * 0.1);
          return (
            <div key={i} style={{ position: 'absolute', left: s.x, top: s.y, width: s.r, height: s.r, borderRadius: '50%', background: '#e8ecff', opacity: s.a * twinkle }} />
          );
        })}
      </div>

      {/* Earth arc: a huge blue planet clipped to the bottom edge */}
      <div style={{ position: 'absolute', left: '50%', bottom: -430, width: 1700, height: 1700, transform: 'translateX(-50%)', opacity: 0.5 + spIn * 0.2 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 35% 28%, #2f6bd8 0%, #214fa0 35%, #13294f 70%, #050a18 100%)', boxShadow: 'inset -120px -60px 160px rgba(0,0,0,0.85), inset 60px 40px 140px rgba(120,180,255,0.2)' }} />
        {/* subtle grid on the earth */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 300, height: 140, borderTop: '1px solid rgba(160,200,255,0.12)', transform: 'rotate(-6deg)' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 420, height: 140, borderTop: '1px solid rgba(160,200,255,0.10)', transform: 'rotate(8deg)' }} />
      </div>

      {/* phone node (phone shell) */}
      <div style={{ position: 'absolute', left: PHONE_CX - PHONE_W * 0.38, top: PHONE_CY - PHONE_H * 0.38 + phoneY, transform: `scale(0.38) rotateZ(-6deg)`, transformOrigin: '0 0', opacity: phoneOn, filter: `drop-shadow(0 0 34px rgba(201,162,39,0.3))` }}>
        <PhoneShell>
          <Img src={staticFile('textures/live/connect-full.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </PhoneShell>
      </div>

      {/* computer node */}
      <div style={{ position: 'absolute', left: COMP_CX - 150, top: COMP_CY - 70 + compY, transform: `scale(1.9)`, transformOrigin: '0 0', opacity: compOn }}>
        <div style={{ width: 150, height: 96, borderRadius: 12, padding: 9, boxSizing: 'border-box', background: 'linear-gradient(160deg,#2A2A2A,#161616)', border: '2px solid rgba(201,162,39,0.6)', boxShadow: '0 26px 60px rgba(0,0,0,0.65), 0 0 40px rgba(201,162,39,0.2)' }}>
          <div style={{ background: 'linear-gradient(135deg,#1a2230,#0B0C10)', borderRadius: 6, width: '100%', height: 46, border: '1px solid rgba(242,242,242,0.08)' }} />
          <div style={{ width: '100%', height: 9, borderRadius: 4, background: 'rgba(242,242,242,0.2)', marginTop: 8 }} />
          <div style={{ width: 70, height: 6, borderRadius: 3, background: 'rgba(201,162,39,0.55)', marginTop: 8 }} />
        </div>
      </div>

      {/* 4G/5G signal rings from the phone */}
      {[ring1, ring2].map((r, idx) => (
        r > 0.01 && r < 1 ? (
          <div key={idx} style={{
            position: 'absolute',
            left: PHONE_CX - 60 - 160 * r,
            top: PHONE_CY - 60 - 160 * r,
            width: 120 + 320 * r,
            height: 120 + 320 * r,
            borderRadius: '50%',
            border: `2px solid ${GOLD_SOFT}`,
            opacity: (1 - r) * 0.7,
            pointerEvents: 'none',
          }} />
        ) : null
      ))}
      {/* tiny 4G / 5G labels near the rings */}
      <div style={{ position: 'absolute', left: PHONE_CX + 150, top: PHONE_CY - 80, fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em', color: GOLD_SOFT, opacity: spIn * phoneOn }}>5G</div>
      <div style={{ position: 'absolute', left: PHONE_CX + 210, top: PHONE_CY + 100, fontFamily: MONO, fontSize: 26, letterSpacing: '0.18em', color: GOLD_SOFT, opacity: spIn * phoneOn * 0.8 }}>4G</div>

      {/* gold connection line with flowing pulse */}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {/* base line faint full-length under the pulse */}
        <path d={linePath} fill="none" stroke={`rgba(201,162,39,${0.22 * lineDraw})`} strokeWidth={3} />
        {/* dash segment travelling L1 -> L2 (the pulse) */}
        {lineDraw > 0 && (
          <path
            d={linePath}
            fill="none"
            stroke={GOLD}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-(flow * 1200)}
          />
        )}
        {/* solid tail that has already been laid down */}
        <path d={linePath} fill="none" stroke={GOLD_SOFT} strokeWidth={1.5} style={{ opacity: lineDraw * 0.5 }} pathLength={1} strokeDasharray={lineDraw} strokeDashoffset={1 - lineDraw} />
      </svg>

      {/* brand lockup: wordmark + bilingual tagline + repo, centered */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ transform: `scale(${breathe})`, transformOrigin: 'center center' }}>
          {/* wordmark "DEEPSEEK" — a single gold sweep glides across the glyphs
              (clipped to the text via background-clip), locking to white */}
          <div
            style={{
              position: 'relative', opacity: wmIn,
              fontFamily: SANS, fontSize: 104, fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1,
              display: 'inline-block',
              backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.92) 0%, ${GOLD_SOFT} 50%, rgba(255,255,255,0.92) 100%)`,
              backgroundSize: '260% 100%',
              backgroundPosition: `${100 - wmSweep * 100}% 0%`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              filter: `drop-shadow(0 0 ${18 * wmSweep}px rgba(201,162,39,0.35))`,
            }}
          >
            DEEPSEEK
          </div>
          {/* whale glyph (a minimal gold whale mark above wordmark) */}
          <div style={{ opacity: wmIn, marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
            <svg width={64} height={38} viewBox="0 0 64 38">
              <path d="M4 30 Q10 12 32 14 Q54 16 60 8 Q56 22 60 30 Q34 34 4 30 Z" fill="none" stroke={GOLD} strokeWidth={3} strokeLinejoin="round" />
              <path d="M14 26 Q24 22 36 24" fill="none" stroke={GOLD} strokeWidth={2.6} strokeLinecap="round" />
              <circle cx={14} cy={19} r={2} fill={GOLD} />
            </svg>
          </div>
          {/* EN main tagline */}
          <div style={{ opacity: tagIn, marginTop: 34, fontFamily: SANS, fontSize: 54, fontWeight: 600, letterSpacing: '0.02em', color: INK }}>
            Phone in hand. <span style={{ color: GOLD }}>Computer at your command.</span>
          </div>
          {/* CN sub */}
          <div style={{ opacity: tagIn * 0.92, marginTop: 14, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 34, letterSpacing: '0.1em', color: CN }}>
            手机控制电脑 · DeepSeek Phone Harness
          </div>
          {/* repo link */}
          <div style={{ opacity: repoIn, marginTop: 26, fontFamily: MONO, fontSize: 30, letterSpacing: '0.05em', color: DIM }}>
            github.com/2903077918-lgtm/DeepSeek-phone-harness
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

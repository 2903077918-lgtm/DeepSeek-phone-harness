// S6 segmented-thumb-hero (681-790): "Models, one tap away." A large capsule
// segmented control ("DeepSeek V3" / "DeepSeek R1") floats in, a finger cursor
// glides in and taps, the white thumb slides ~8f, and the model icon pops over
// the newly selected segment. Skinned with the dark/gold product tokens.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing, spring, useVideoConfig } from 'remotion';

const SANS = 'Inter, "SF Pro Display", "PingFang SC", system-ui, sans-serif';
const GOLD = '#C9A227';
const INK = '#F2F2F2';
const MID = 'rgba(242,242,242,0.55)';

const FingerCursor: React.FC<{ x: number; y: number; press: number }> = ({ x, y, press }) => (
  <svg
    width={200}
    height={230}
    viewBox="0 0 26 30"
    style={{
      position: 'absolute',
      left: x,
      top: y,
      transform: `scale(${1 - press * 0.12})`,
      transformOrigin: '15% 10%',
      filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.5))',
    }}
  >
    <path d="M4 2 L4 24 L9.5 18.5 L13 27 L16.8 25.4 L13.3 17 L21 17 Z" fill="#fff" stroke={GOLD} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

const V3Icon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <rect x={6} y={6} width={28} height={28} rx={7} fill="none" stroke={GOLD} strokeWidth={3} />
    <path d="M13 16 L20 24 L27 16" stroke={GOLD} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const R1Icon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <circle cx={20} cy={20} r={13} fill="none" stroke={GOLD} strokeWidth={3} />
    <path d="M15 24 v-9 l4 5 4-5 v9" stroke={GOLD} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SceneSegmented: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const FLOAT_IN = 0;
  const CURSOR_IN = 16;
  const CLICK = 40;
  const SLIDE = 44;
  const SLIDE_END = 52;

  const floatT = spring({ frame: frame - FLOAT_IN, fps, config: { damping: 14, stiffness: 110, mass: 0.9 } });
  const ctrlY = interpolate(floatT, [0, 1], [220, 0]);

  const CW = 1120;
  const CH = 224;
  const PAD = 16;
  const SEGW = (CW - PAD * 2) / 2;

  const curT = interpolate(frame, [CURSOR_IN, CURSOR_IN + 22], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const curX = interpolate(curT, [0, 1], [1810, 1220]);
  const curY = interpolate(curT, [0, 1], [1020, 600]);
  const press = interpolate(frame, [CLICK, CLICK + 3, CLICK + 8], [0, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const thumbT = interpolate(frame, [SLIDE, SLIDE_END], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const thumbX = PAD + thumbT * SEGW;

  const iconIn = spring({ frame: frame - SLIDE_END, fps, config: { damping: 10, stiffness: 220, mass: 0.6 } });
  const r1Scale = frame >= SLIDE_END ? iconIn : 0;
  const v3Scale = interpolate(frame, [SLIDE, SLIDE + 6], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic),
  });

  const rippleT = interpolate(frame, [CLICK, CLICK + 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad),
  });

  const labelStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: SANS, fontWeight: 600, fontSize: 64,
    color: active ? INK : MID,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22,
    width: SEGW, height: CH - PAD * 2, position: 'relative', zIndex: 2,
  });

  const v3Active = thumbT < 0.5;

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 40%, #191919 0%, #0B0C10 74%)', alignItems: 'center', justifyContent: 'center' }}>
      {/* gold bloom behind the control */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 900, height: 500, transform: 'translate(-50%,-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.10), transparent)', filter: 'blur(24px)' }} />
      <div style={{ position: 'relative', transform: `translateY(${ctrlY}px)`, opacity: Math.min(1, floatT * 1.4) }}>
        <div
          style={{
            width: CW, height: CH, borderRadius: CH / 2,
            background: 'rgba(42,42,42,0.9)',
            border: '3px solid rgba(242,242,242,0.14)',
            boxShadow: `0 ${28 - floatT * 14}px ${80 - floatT * 24}px rgba(0,0,0,0.5)`,
            position: 'relative', display: 'flex', alignItems: 'center', padding: PAD, boxSizing: 'border-box',
          }}
        >
          {/* white thumb */}
          <div
            style={{
              position: 'absolute', left: thumbX, top: PAD,
              width: SEGW, height: CH - PAD * 2,
              borderRadius: (CH - PAD * 2) / 2,
              background: '#1c1c1e',
              border: `1.5px solid ${GOLD}`,
              boxShadow: '0 8px 26px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(201,162,39,0.35)',
              zIndex: 1,
            }}
          />
          {/* tap ripple */}
          {rippleT > 0 && rippleT < 1 && (
            <div
              style={{
                position: 'absolute',
                left: PAD + SEGW * 1.5 - 130 * rippleT,
                top: CH / 2 - 130 * rippleT,
                width: 260 * rippleT, height: 260 * rippleT,
                borderRadius: '50%',
                border: `4px solid ${GOLD}`,
                opacity: (1 - rippleT) * 0.8,
                zIndex: 3,
              }}
            />
          )}
          {/* DeepSeek V3 (left segment) */}
          <div style={labelStyle(v3Active)}>
            <span style={{ display: 'inline-flex', transform: `scale(${v3Scale})`, width: v3Scale < 0.05 ? 0 : 66, overflow: 'visible' }}>
              <V3Icon size={66} />
            </span>
            DeepSeek V3
          </div>
          {/* DeepSeek R1 (right segment) */}
          <div style={labelStyle(!v3Active)}>
            <span style={{ display: 'inline-flex', transform: `scale(${r1Scale})`, width: r1Scale < 0.05 ? 0 : 66, overflow: 'visible' }}>
              <R1Icon size={66} />
            </span>
            DeepSeek R1
          </div>
        </div>
      </div>
      <FingerCursor x={curX} y={curY} press={press} />
    </AbsoluteFill>
  );
};

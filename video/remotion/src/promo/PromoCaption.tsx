// Bilingual subtitle strip: EN main (large, readable) + CN secondary below it,
// shown over the dark field of each shot. Reads clearly on 1080p (EN ≥56px).
import { interpolate, useCurrentFrame } from 'remotion';

const SANS = 'Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

export const PromoCaption: React.FC<{ en: string; cn: string; duration: number; bottom?: number }> = ({
  en,
  cn,
  duration,
  bottom = 56,
}) => {
  const frame = useCurrentFrame();
  const inT = interpolate(frame, [6, 16], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const outT = interpolate(frame, [Math.max(0, duration - 14), duration], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const op = Math.min(inT, outT);

  // fade two-stage: EN looks slightly earlier than CN
  const cnOp = Math.min(inT, outT) * 0.94;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0, right: 0, bottom,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        textAlign: 'center', pointerEvents: 'none',
      }}
    >
      {/* scrim for readability over bright areas */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: -30, bottom: -16, background: 'linear-gradient(to top, rgba(5,6,10,0.78), rgba(5,6,10,0.55) 30%, transparent)', opacity: op }} />
      <div style={{ position: 'relative', opacity: op, transform: `translateY(${(1 - inT) * 10}px)`, fontFamily: SANS, fontSize: 56, fontWeight: 600, letterSpacing: '0.02em', color: '#F2F2F2', lineHeight: 1.1, textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>
        {en}
      </div>
      <div style={{ position: 'relative', opacity: cnOp, transform: `translateY(${(1 - inT) * 10}px)`, fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif', fontSize: 34, letterSpacing: '0.08em', color: 'rgba(201,162,39,0.92)', lineHeight: 1.15, textShadow: '0 2px 10px rgba(0,0,0,0.8)', marginTop: 8 }}>
        {cn}
      </div>
    </div>
  );
};

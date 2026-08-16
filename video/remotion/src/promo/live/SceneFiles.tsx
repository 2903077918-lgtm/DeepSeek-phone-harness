// S5 overhead tilt-reveal (561-680): "your files, in your pocket." The phone's
// file page lies flat on the dark desk (top-down, foreshortened), then the
// camera rights up to a readable head-on view while the file list is revealed
// row-by-row by an upward wipe — the files genuinely pour into sight as the
// plane tips up. Floating gold file-path chips pop in around the phone to anchor
// the "files travel with you" message and keep the dark page legible.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { PhoneShell, PHONE_W, PHONE_H } from './PhoneFrame';

const HOLD = 14;
const MOVE = 43;
const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.9)';
const DIM = 'rgba(242,242,242,0.7)';
const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';

// floating file-path chips (screen-space, deterministic, readable ≥32px)
const CHIPS = [
  { x: 250, y: 300, label: 'C:/Users/demo/My-Project/config.json', delay: 16 },
  { x: 1420, y: 400, label: '~/notes/launch-plan.md', delay: 24 },
  { x: 380, y: 700, label: 'assets/brand/logo.svg', delay: 32 },
  { x: 1380, y: 720, label: 'README.md', delay: 40 },
];

export const SceneFiles: React.FC = () => {
  const f = useCurrentFrame();

  const rotX = interpolate(
    f,
    [HOLD, HOLD + MOVE, HOLD + MOVE + 4, HOLD + MOVE + 8],
    [-78, 2.4, -0.9, 0],
    { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const p = interpolate(f, [HOLD, HOLD + MOVE], [0, 1], {
    easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const scale = interpolate(p, [0, 1], [1.75, 1.6]);
  const persp = interpolate(p, [0, 1], [600, 1500]);
  const perspY = interpolate(p, [0, 1], [10, 45]);

  // reveal sweep: phone + file list revealed from top to bottom as it rights
  const reveal = interpolate(p, [0, 1], [0, 1], { easing: Easing.bezier(0.3, 0, 0.2, 1) });
  // key light raking across the screen as it rights
  const key = interpolate(p, [0, 1], [0, 1], { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 38%, #191919 0%, #0B0C10 74%)' }}>
      {/* the "desk": a slightly lighter surface under the flat phone */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(70% 40% at 50% 80%, rgba(201,162,39,0.06), transparent 70%)' }} />
      <div style={{ position: 'absolute', inset: 0, perspective: persp, perspectiveOrigin: `50% ${perspY}%` }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d' }}>
          <div
            style={{
              position: 'absolute',
              width: PHONE_W,
              height: PHONE_H,
              transformStyle: 'preserve-3d',
              transform: `translate3d(${-PHONE_W / 2}px, ${-PHONE_H / 2}px, 0) scale(${scale}) rotateX(${rotX}deg)`,
              transformOrigin: 'center center',
            }}
          >
            <PhoneShell>
              <Img src={staticFile('textures/live/files-full.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
              {/* key light raking the screen top-left (defines the dark UI) */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.16), transparent 42%)', opacity: key * 0.8 }} />
              {/* upward row-by-row reveal wipe */}
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 90% at 50% 30%, #14141a 0%, #07090f 80%)', clipPath: `inset(0 0 ${(1 - reveal) * 100}% 0)` }} />
              {/* gold edge glint along the bottom as it rights */}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`, opacity: (1 - reveal) * 0.7 }} />
            </PhoneShell>
          </div>
        </div>
      </div>

      {/* floating file-path chips around the phone */}
      {CHIPS.map((ch) => {
        const t = interpolate(f, [ch.delay, ch.delay + 14], [0, 1], {
          easing: Easing.bezier(0.2, 0.8, 0.3, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        });
        if (t <= 0) return null;
        return (
          <div
            key={ch.label}
            style={{
              position: 'absolute', left: ch.x, top: ch.y, opacity: t,
              transform: `translateY(${(1 - t) * 22}px)`,
              fontFamily: MONO, fontSize: 30, letterSpacing: '0.02em', color: DIM,
              background: 'rgba(14,15,20,0.72)', padding: '10px 16px', borderRadius: 10,
              border: `1px solid rgba(201,162,39,0.4)`,
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
            }}
          >
            <span style={{ color: GOLD }}>▸</span> {ch.label}
          </div>
        );
      })}

      {/* soft floor shadow under the flat phone */}
      <div style={{ position: 'absolute', left: '50%', bottom: 130, width: 660, height: 100, transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.10), rgba(0,0,0,0.5) 72%, transparent)', filter: 'blur(22px)' }} />
    </AbsoluteFill>
  );
};

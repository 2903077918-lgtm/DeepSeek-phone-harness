// S1 brand-ink-open (0-83): gold crosshair pen-draws, the wordmark
// "DEEPSEEK" letterpresses glyph-by-glyph onto the dark metal background, a
// mono kicker types out, the whole lockup RESTs fully-on (~1s), then lifts &
// shrinks & dissolves out handing to S2. Adapted from the validated template
// brand segment (frames 0-83 of SceneOpen) onto the Phone Harness tokens.
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { SHOTS } from '../SHOTS';

const SANS = 'Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Menlo, monospace';

const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.85)';
const INK = '#F2F2F2'; // text token
const INK_DIM = 'rgba(242,242,242,0.55)';

const WORDMARK = 'DEEPSEEK';
const KICKER = 'REMOTE CONTROL FOR DEEPSEEK HARNESS';

export const SceneOpen: React.FC = () => {
  const frame = useCurrentFrame();

  // --- crosshair draw-on (SVG pathLength=100) ---
  const vDraw = interpolate(frame, [0, 10], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const hDraw = interpolate(frame, [9, 19], [100, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.linear,
  });
  const crossFade = interpolate(frame, [26, 36], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // --- kicker typewriter (28 -> ~45), 0.5f/char so it completes in time for
  // the 46->76 full-lockup hold ---
  const perChar = 0.5;
  const kickStart = 28;
  const kickChars = Math.floor(Math.max(0, frame - kickStart) / perChar);
  const kickDone = kickStart + KICKER.length * perChar;
  const cursorOn = (() => {
    if (frame < kickStart) return false;
    if (frame < kickDone) return true;
    if (frame > 74) return false;
    const b = frame - kickDone;
    return Math.floor(b / 2) % 2 === 0;
  })();

  // --- brand group rests fully-on 46->76, then dissolves out 76->83 ---
  const brandOut = interpolate(frame, [76, 83], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  const brandOpacity = 1 - brandOut;
  const groupY = -brandOut * 40;
  const groupScale = 1 - brandOut * 0.12;

  // --- a faint gold dust / return node pulse in the metal background, so the
  // dark field isn't dead while the crosshair draws ---
  const bgPulse = 0.5 + 0.5 * Math.sin((frame / 90) * Math.PI * 2);

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 38%, #191919 0%, #0B0C10 70%)' }}>
      {/* faint brushed-metal horizontal hairline */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          height: 2, opacity: 0.5 + bgPulse * 0.2,
          background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.14) 50%, transparent)',
        }}
      />
      {/* soft vertical light shaft */}
      <div
        style={{
          position: 'absolute', left: '50%', top: 0, bottom: 0, width: 560,
          transform: 'translateX(-50%)',
          background: 'radial-gradient(closest-side, rgba(201,162,39,0.05), transparent)',
        }}
      />

      {/* brand group */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', pointerEvents: 'none', opacity: brandOpacity }}>
        <div style={{ textAlign: 'center', transform: `translateY(${groupY}px) scale(${groupScale})`, transformOrigin: 'center center' }}>
          {/* crosshair gold pen-draw */}
          <svg
            width={68}
            height={68}
            viewBox="0 0 68 68"
            style={{ display: 'block', margin: '0 auto 40px', opacity: crossFade }}
          >
            <line x1={34} y1={2} x2={34} y2={66} stroke={GOLD} strokeWidth={5} strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={vDraw} />
            <line x1={2} y1={34} x2={66} y2={34} stroke={GOLD} strokeWidth={5} strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={hDraw} />
          </svg>

          {/* wordmark: glyph-by-glyph letterpress with gold under-glint */}
          <div
            style={{
              fontFamily: SANS, fontSize: 138, fontWeight: 700, color: INK,
              letterSpacing: '0.02em', lineHeight: 1, whiteSpace: 'pre',
              display: 'inline-flex', alignItems: 'flex-end',
            }}
          >
            {WORDMARK.split('').map((ch, i) => {
              const delay = 10 + i * 3;
              const t = interpolate(frame, [delay, delay + 12], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
                easing: Easing.bezier(0.2, 0.7, 0.25, 1),
              });
              const glintCenter = delay + 12;
              const glint = interpolate(frame, [glintCenter - 4, glintCenter, glintCenter + 4], [0, 1, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              return (
                <span
                  key={i}
                  style={{
                    position: 'relative', display: 'inline-block', opacity: t,
                    transform: `scale(${1.5 - 0.5 * t})`,
                    transformOrigin: 'center bottom',
                    filter: `blur(${(1 - t) * 6}px)`,
                  }}
                >
                  {ch === ' ' ? ' ' : ch}
                  <span
                    style={{
                      position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)',
                      width: `${glint * 100}%`, height: 2, background: GOLD, opacity: glint, borderRadius: 2,
                    }}
                  />
                </span>
              );
            })}
          </div>

          {/* mono kicker typewriter + gold block cursor */}
          <div
            style={{
              fontFamily: MONO, fontSize: 24, letterSpacing: '0.14em', color: INK_DIM,
              marginTop: 32, textTransform: 'uppercase', height: 30,
              display: 'flex', justifyContent: 'center', alignItems: 'center',
            }}
          >
            <span style={{ whiteSpace: 'pre' }}>{KICKER.slice(0, kickChars)}</span>
            <span
              style={{
                display: 'inline-block', width: 14, height: 24, marginLeft: 6,
                background: GOLD, opacity: cursorOn ? 0.85 : 0,
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

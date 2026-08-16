// T1 line-carry-transition (291-410): the signature hand-off. A gold progress
// line (the "answer in progress" that S3 filled) extends, then CARRIES the
// camera leftward while the line tip stays pinned near screen x≈1500; the line
// then turns a right angle and frames a question-tool card whose content fades
// in; then a true 36f rest. "Answer. Don't wait." — the approval/question card
// is the heartbeat of controlling the computer from your phone.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import layout from '../../../public/textures/live/layout.json';
import { PHONE_W } from './PhoneFrame';

const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.85)';
const INK = '#F2F2F2';
const DIM = 'rgba(242,242,242,0.55)';

// world geometry (2880 wide: A panel 0..1440, B panel 1440..2880)
// PATH: base line 360,820 -> 2200,820 ; up 2200,820 -> 2200,470 ; right
// 2200,470 -> 2760,470 ; down 2760,470 -> 2760,820 ; left back 2760,820 -> 2200,820
const PATH = 'M 360 820 L 2200 820 L 2200 470 L 2760 470 L 2760 820 L 2200 820';
const SEGS: Array<[number, number, number, number, number]> = [
  [360, 820, 2200, 820, 1840],
  [2200, 820, 2200, 470, 350],
  [2200, 470, 2760, 470, 560],
  [2760, 470, 2760, 820, 350],
  [2760, 820, 2200, 820, 560],
];
const TOTAL = 1840 + 350 + 560 + 350 + 560;

const tipAt = (drawn: number): [number, number] => {
  let d = Math.max(0, Math.min(drawn, TOTAL));
  for (const [x1, y1, x2, y2, len] of SEGS) {
    if (d <= len) {
      const u = d / len;
      return [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u];
    }
    d -= len;
  }
  return [2200, 820];
};

export const SceneCarry: React.FC = () => {
  const frame = useCurrentFrame();

  // camera slides 1440px left over 18..62
  const cam = interpolate(frame, [18, 62], [0, 1440], {
    easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // drawn length: base fill -> burst -> carry with camera -> frame close
  let drawn: number;
  if (frame < 12) {
    drawn = interpolate(frame, [0, 12], [0, 1840], { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (frame < 18) {
    drawn = interpolate(frame, [12, 18], [1840, 2340], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  } else if (frame < 62) {
    drawn = 2340 + cam * (2840 - 2340) / 1440; // grows with the camera carry
  } else {
    drawn = interpolate(frame, [62, 76], [2840, TOTAL], { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  }

  // question card content fades in after the frame closes (76..84), then 36f rest
  const contentOpacity = interpolate(frame, [76, 84], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.3, 0, 0.2, 1),
  });

  // pen-tip ink dot: rides the pen, dissipates 88..92 then unmounts
  const tipMounted = frame < 92;
  const tipOpacity = interpolate(frame, [84, 92], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const [tx, ty] = tipAt(drawn);

  // Question-card world placement: frame at world 2200,470 -> 2760,820.
  // Render the real question-card.png slice scaled to the frame.
  const qw = 560;
  const qh = 350;
  const QX = 2200;
  const QY = 470;

  return (
    <AbsoluteFill style={{ background: '#0B0C10', overflow: 'hidden' }}>
      {/* world container: 2880 wide, camera slides left = follows the line */}
      <div style={{ position: 'absolute', width: 2880, height: 1080, transform: `translateX(${-cam}px)` }}>
        {/* B panel slightly lifted bg (the "new world" of the question card) */}
        <div style={{ position: 'absolute', left: 1440, top: 0, width: 1440, height: 1080, background: 'radial-gradient(120% 90% at 60% 40%, #16161a 0%, #0B0C10 75%)' }} />
        {/* A panel clean field */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1440, height: 1080, background: 'radial-gradient(120% 90% at 40% 40%, #16161a 0%, #0B0C10 75%)' }} />

        {/* A-side context: a faint label of what the line came from */}
        <div style={{ position: 'absolute', left: 120, top: 300, fontFamily: 'Inter, "SF Pro Display", system-ui', fontSize: 30, letterSpacing: '0.06em', color: DIM }}>
          AGENT WORKING
        </div>

        {/* the evolving gold line */}
        <svg width={2880} height={1080} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <path
            d={PATH}
            fill="none"
            stroke={GOLD}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={TOTAL}
            strokeDashoffset={TOTAL - drawn}
          />
          {tipMounted && <circle cx={tx} cy={ty} r={10} fill={GOLD} opacity={tipOpacity} />}
        </svg>

        {/* question-card content framed by the line — the REAL approval card
            texture (fiction data) fades in cleanly inside the line frame */}
        <div
          style={{
            position: 'absolute', left: QX, top: QY, width: qw, height: qh,
            boxSizing: 'border-box', opacity: contentOpacity,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, background: 'linear-gradient(160deg, #16161b, #0e0f14)', borderRadius: 18,
          }}
        >
          <Img
            src={staticFile('textures/live/question-card.png')}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

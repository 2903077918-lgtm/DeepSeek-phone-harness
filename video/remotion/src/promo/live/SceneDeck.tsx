// S3 deck-deal-flyin (204-291): the phone's chat page is on a readable head-on
// view. The two live tool cards (tool-read = "read file path", tool-shell =
// "run command") DEAL in from the right edge with hard-accelerating rhythm,
// overshoot-settle into their real layout slots, and a bottom progress bar
// (the agent's working indicator) runs full by the end — the hand-off anchor to
// T1's line-carry transition.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import layout from '../../../public/textures/live/layout.json';
import { PhoneShell, PHONE_W, PHONE_H } from './PhoneFrame';

const GOLD = '#C9A227';
const GOLD_SOFT = 'rgba(201,162,39,0.85)';

type ToolCard = {
  key: string;
  img: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cue: number; // dealing cue frame
  deckDir: number; // +1 deal in from right, -1 from left
};

const TOOL_CARDS: ToolCard[] = [
  { key: 'r', img: 'tool-read.png', x: layout.toolRead.x, y: layout.toolRead.y, w: layout.toolRead.w, h: layout.toolRead.h, cue: 6, deckDir: 1 },
  { key: 's', img: 'tool-shell.png', x: layout.toolShell.x, y: layout.toolShell.y, w: layout.toolShell.w, h: layout.toolShell.h, cue: 20, deckDir: -1 },
];

const dealEase = Easing.bezier(0.3, 0, 0.2, 1); // flight
const settleEase = Easing.bezier(0.3, 0, 0.25, 1.15); // overshoot settle (y1>1)

export const SceneDeck: React.FC = () => {
  const frame = useCurrentFrame();

  const scale = 1.0; // ~852px tall phone on the 1080p frame (clear, centered)
  const fx0 = 960 - (0.5 * PHONE_W * scale);
  const fy0 = 540 - (0.5 * PHONE_H * scale);

  // progress bar (bottom edge of the page) fills ~50..87f -> full by the
  // scene's last frame (the hand-off anchor to T1's line-carry)
  const prog = interpolate(frame, [50, 82], [0, 1], {
    easing: Easing.bezier(0.3, 0, 0.2, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 38%, #191919 0%, #0B0C10 74%)' }}>
      {/* gold bloom */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 700, height: 700, transform: 'translate(-50%,-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.09), transparent)', filter: 'blur(22px)' }} />

      {/* the phone, head-on */}
      <div style={{ position: 'absolute', left: fx0, top: fy0, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <PhoneShell>
          <Img src={staticFile('textures/live/chat-full.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />

          {/* hidden native tool cards sit in their slots; the dealing copies fly in
              on top and settle flush (Q9: real slot, no hovering) */}
          {TOOL_CARDS.map((c) => {
            const k = c.deckDir;
            const fl = 8; // flight frames
            const st = 4; // settle frames (overshoot scale)
            const pr = 2; // press frames
            const stFrom = c.cue + fl;
            const prFrom = stFrom + st;
            const done = stFrom + st + pr + 1; // frames until fully landed

            // flight 0->1 over [cue, cue+fl]
            const ft = interpolate(frame, [c.cue, c.cue + fl], [0, 1], {
              easing: k > 0 ? dealEase : Easing.bezier(0.25, 0.05, 0.3, 1),
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            // settle overshoot T over [stFrom, stFrom+st]
            const stT = interpolate(frame, [stFrom, stFrom + st], [0, 1], {
              easing: settleEase, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            const press = interpolate(frame, [prFrom, prFrom + pr, prFrom + pr + 1], [1, 0.996, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });

            // mounted only during the animated window; after that the baked
            // page texture provides the landed card
            if (frame < c.cue || frame >= done) return null;

            // flying = still in the fast flight window (before settle starts)
            const flying = frame < stFrom;
            // z-arc peaks during flight, fades to 0 as it settles
            const zArc = flying ? Math.sin(ft * Math.PI) * 60 : 0;
            const sx = k > 0 ? 1.06 - 0.06 * stT : 1.03 - 0.03 * stT; // settle scale overshoot -> 1
            const overshoot = k > 0 ? 12 * Math.sin(stT * Math.PI) : 0;
            // horizontal sweep: 1->0 across the flight window (fast) then stays
            const dealX = (1 - ft) * (k === 1 ? 420 : -420);
            const stillSettling = frame < stFrom + st ? 1 : 0;

            return (
              <div
                key={c.key}
                style={{
                  position: 'absolute',
                  left: c.x,
                  top: c.y,
                  width: c.w,
                  height: c.h,
                  transform: `translate3d(${dealX + overshoot * stillSettling}px, ${(1 - ft) * -30}px, ${zArc}px) scale(${sx * press})`,
                  transformStyle: 'preserve-3d',
                }}
              >
                <Img src={staticFile(`textures/live/${c.img}`)} style={{ width: '100%', height: '100%', display: 'block', filter: frame < c.cue + 4 ? 'blur(1px)' : 'none' }} />
              </div>
            );
          })}

          {/* progress bar at the bottom of the tool area */}
          <div
            style={{
              position: 'absolute',
              left: 16,
              bottom: 16,
              width: PHONE_W - 32,
              height: 7,
              borderRadius: 4,
              background: 'rgba(242,242,242,0.12)',
              overflow: 'hidden',
            }}
          >
            <div style={{ width: `${prog * 100}%`, height: '100%', borderRadius: 4, background: `linear-gradient(90deg, ${GOLD_SOFT}, ${GOLD})` }} />
          </div>
        </PhoneShell>
      </div>
    </AbsoluteFill>
  );
};

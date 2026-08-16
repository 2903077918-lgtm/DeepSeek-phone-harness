// S2 graze-face-tour (84-203): the phone's chat page surfaces from a flat graze
// and the camera tilts up into a readable head-on view while pushing in and
// travelling DOWN the conversation. Each live element (user bubble, the read /
// shell tool cards, the assistant bubble, the question card) floats up off the
// phone surface with a soft matching shadow, then settles back down in the order
// the camera passes over them.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';
import { PhoneShell, PHONE_W, PHONE_H } from './PhoneFrame';

const easeIO = Easing.bezier(0.45, 0, 0.25, 1);
const easeFall = Easing.bezier(0.5, 0.05, 0.6, 1);

type Slice = {
  key: string;
  img: string;
  x: number;
  y: number;
  w: number;
  h: number;
  land: number;
};

const SLICES: Slice[] = [
  { key: 'user', img: 'user-bubble.png', x: 80, y: 211, w: 299, h: 66, land: 0.20 },
  { key: 'toolRead', img: 'tool-read.png', x: 14, y: 293, w: 365, h: 55, land: 0.38 },
  { key: 'toolShell', img: 'tool-shell.png', x: 14, y: 364, w: 365, h: 55, land: 0.52 },
  { key: 'asst', img: 'asst-bubble.png', x: 48, y: 435, w: 331, h: 96, land: 0.68 },
  { key: 'qcard', img: 'question-card.png', x: 14, y: 548, w: 365, h: 179, land: 0.86 },
];

const liftOf = (t: number, land: number, H = 120) => {
  const FALL = 0.34;
  const p = Math.min(1, Math.max(0, (t - (land - FALL)) / FALL));
  return (1 - easeFall(p)) * H;
};

export const SceneGraze: React.FC = () => {
  const duration = 120;
  const frame = useCurrentFrame();
  const t = Math.min(1, Math.max(0, frame / duration));

  // camera: start flat-grazing the surface, push in + tilt up to head-on;
  // the focal point travels DOWN the phone (0=top .. 1=bottom) as the
  // conversation reveals, so the phone translates upward.
  const rotX = interpolate(frame, [0, 70], [50, 8], { easing: easeIO, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scale = interpolate(frame, [0, 70], [1.05, 1.5], { easing: easeIO, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const focusT = interpolate(frame, [0, 90], [0.34, 0.64], { easing: easeIO, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // push the phone up so the in-focus band sits near screen center
  const panY = interpolate(focusT, [0, 1], [260, 60], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const persp = interpolate(frame, [0, 70], [650, 1400], { easing: easeIO, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 36%, #16161a 0%, #0B0C10 72%)' }}>
      <div style={{ position: 'absolute', left: '50%', top: '46%', width: 900, height: 900, transform: 'translate(-50%,-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.10), transparent)', filter: 'blur(20px)' }} />

      <div style={{ position: 'absolute', inset: 0, perspective: persp, perspectiveOrigin: '50% 42%' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d' }}>
          <div
            style={{
              position: 'absolute',
              width: PHONE_W,
              height: PHONE_H,
              transformStyle: 'preserve-3d',
              transform: `translate3d(${-PHONE_W / 2}px, ${-PHONE_H / 2 + panY}px, 0) scale(${scale}) rotateX(${rotX}deg)`,
              transformOrigin: 'center center',
            }}
          >
            <PhoneShell>
              <Img src={staticFile('textures/live/chat-full.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
              {SLICES.map((s) => {
                const hh = liftOf(t, s.land);
                const dz = hh * 0.55;
                const dx = -hh * 0.34;
                const dy = -hh * 0.78;
                return (
                  <div key={s.key} style={{ position: 'absolute', left: s.x, top: s.y, width: s.w, height: s.h }}>
                    {hh > 1.5 && (
                      <div style={{ position: 'absolute', left: 0, top: 0, width: s.w, height: s.h, opacity: Math.min(0.42, 0.16 + hh * 0.004), pointerEvents: 'none' }}>
                        <Img src={staticFile(`textures/live/${s.img}`)} style={{ width: '100%', filter: `blur(${3.5 + hh * 0.09}px) brightness(0.22) saturate(0.4)` }} />
                      </div>
                    )}
                    <div style={{ position: 'absolute', left: 0, top: 0, width: s.w, height: s.h, transform: `translate3d(${dx}px, ${dy}px, ${dz}px)`, transformStyle: 'preserve-3d' }}>
                      <Img src={staticFile(`textures/live/${s.img}`)} style={{ width: '100%', height: '100%', display: 'block' }} />
                    </div>
                  </div>
                );
              })}
            </PhoneShell>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: '50%', bottom: 90, width: 820, height: 120, transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.12), rgba(0,0,0,0.5) 70%, transparent)', filter: 'blur(24px)' }} />
    </AbsoluteFill>
  );
};

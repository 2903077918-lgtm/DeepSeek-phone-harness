// S4 terminal-3d (411-560): "your computer, at your fingertips." Three terminal
// windows (the computer being driven from the phone) are posed in 3D and the
// camera flies between them; at each window a command the user typed on the
// phone types out and result rows scroll in. A phone controller badge sits
// top-right. Clean center-anchored CSS-3D camera; windows large & readable.
// Fictional demo data.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { PhoneShell } from './PhoneFrame';

const MONO = 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace';
const GOLD = '#C9A227';
const GOLD_DIM = 'rgba(201,162,39,0.7)';

const WW = 620;
const WH = 360;

type Win = {
  pos: { x: number; y: number; z: number; ry: number };
  title: string;
  cmd: string;
  out: string[];
  step: [number, number];
  type: number;
};

const DATA: Win[] = [
  {
    pos: { x: -260, y: -20, z: 40, ry: 14 },
    title: '~/ph-harness — zsh',
    cmd: '$ cat config.json',
    out: ['{', '  "tailscale": "100.64.0.2"', '  "port": 8731', '}'],
    step: [0.05, 0.30],
    type: 0.34,
  },
  {
    pos: { x: 60, y: 95, z: 120, ry: -12 },
    title: 'dev agent console',
    cmd: '$ run tool read',
    out: ['TOOL read  C:/Users/demo/My-Project/config.json', '-> 200 OK (42ms)'],
    step: [0.38, 0.63],
    type: 0.67,
  },
  {
    pos: { x: 300, y: -60, z: 70, ry: -20 },
    title: 'worker logs',
    cmd: '$ tail -f agent.log',
    out: ['12:04:11 step=2 tool=read  done 41ms', '12:04:14 step=3 approved  on phone', '12:04:15 applied on computer'],
    step: [0.71, 0.96],
    type: 1.0,
  },
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number, ease: (x: number) => number = (x) => x) =>
  ease(clamp01((t - a) / (b - a)));
const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

export const SceneTerminal: React.FC = () => {
  const duration = 150;
  const frame = useCurrentFrame();
  const t = clamp01(frame / duration);

  // camera centre (world coords) swings between window poses
  let cx = DATA[0].pos.x, cy = DATA[0].pos.y, cz = DATA[0].pos.z, cry = DATA[0].pos.ry;
  for (let i = 1; i < 3; i++) {
    const p = DATA[i - 1].pos;
    const q = DATA[i].pos;
    const u = seg(t, DATA[i].step[0], DATA[i].step[1], easeIO);
    cx += (q.x - p.x) * u;
    cy += (q.y - p.y) * u;
    cz += (q.z - p.z) * u;
    cry += (q.ry - p.ry) * u;
  }
  // pull-back during each flight (windows momentarily recede / reveal choice)
  let pull = 0;
  for (let i = 1; i < 3; i++) pull += Math.sin(seg(t, DATA[i].step[0], DATA[i].step[1]) * Math.PI) * 150;

  return (
    <AbsoluteFill style={{ background: 'radial-gradient(110% 90% at 50% 30%, #15151c 0%, #0B0C10 75%)' }}>
      {/* ambient gold glow centre */}
      <div style={{ position: 'absolute', left: '50%', top: '45%', width: 1300, height: 900, transform: 'translate(-50%,-50%)', background: 'radial-gradient(closest-side, rgba(201,162,39,0.08), transparent)', filter: 'blur(30px)' }} />

      {/* phone controller badge top-right */}
      <div style={{ position: 'absolute', right: 110, top: -30, transform: 'scale(0.6) rotateZ(-6deg)', transformOrigin: '0 0', opacity: 0.98, zIndex: 10 }}>
        <PhoneShell>
          <Img src={staticFile('textures/live/terminal-full.png')} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </PhoneShell>
      </div>

      <div style={{ position: 'absolute', inset: 0, perspective: 1500, perspectiveOrigin: '50% 45%' }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d' }}>
          {/* camera group: swing rotation + inverse camera translation + pull */}
          <div
            style={{
              position: 'absolute',
              width: 0, height: 0,
              transformStyle: 'preserve-3d',
              transform: `translateZ(${pull}px) rotateY(${-cry}deg) translate3d(${-cx}px, ${-cy}px, ${-cz}px)`,
            }}
          >
            {DATA.map((w, i) => {
              const focus = 1 - Math.min(1, Math.abs(cx - w.pos.x) / 500);
              const ty = seg(t, w.type, Math.min(1, w.type + 0.12));
              const n = Math.floor(ty * w.cmd.length + 0.0001);
              const caretOp = ty >= 1
                ? (Math.floor(t * 26) % 2 ? 0.15 : 0.9)
                : (Math.floor(t * 40) % 2 ? 0.35 : 1);
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: WW, height: WH, left: -WW / 2, top: -WH / 2,
                    transformStyle: 'preserve-3d',
                    transform: `translate3d(${w.pos.x}px, ${w.pos.y}px, ${w.pos.z}px) rotateY(${w.pos.ry}deg)`,
                    opacity: 0.5 + focus * 0.5,
                    filter: `blur(${(1 - focus) * 2.5}px) brightness(${0.85 + focus * 0.15})`,
                  }}
                >
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 14, background: '#0e1017', border: `2px solid ${i === 1 ? GOLD : GOLD_DIM}`, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.7)' }}>
                    {/* title bar */}
                    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 40, background: 'linear-gradient(180deg,#22272f,#171b24)', borderBottom: '1px solid #2a3040' }}>
                      {['#ff6058', '#ffbd2e', '#28ca42'].map((c, k) => (
                        <div key={c} style={{ position: 'absolute', left: 16 + k * 22, top: 13, width: 13, height: 13, borderRadius: '50%', background: c }} />
                      ))}
                      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 40, textAlign: 'center', font: `600 15px/40px ${MONO}`, color: '#8b94ad' }}>{w.title}</div>
                    </div>
                    {/* command */}
                    <div style={{ position: 'absolute', left: 24, top: 66, font: `600 19px/1 ${MONO}`, color: GOLD, whiteSpace: 'pre' }}>
                      {Array.from(w.cmd, (ch, c) => <span key={c} style={{ opacity: c < n ? 1 : 0 }}>{ch === ' ' ? ' ' : ch}</span>)}
                      <span style={{ color: GOLD, opacity: caretOp, display: 'inline-block' }}>▌</span>
                    </div>
                    {/* output rows */}
                    {w.out.map((o, k) => {
                      const ou = seg(t, w.type + 0.14 + k * 0.02, w.type + 0.19 + k * 0.02, easeOut);
                      const isCmd = /(TOOL|->|200|applied|approved)/.test(o);
                      return (
                        <div key={k} style={{ position: 'absolute', left: 24, top: 108 + k * 34, font: `500 17px/1 ${MONO}`, color: isCmd ? GOLD : (k === 0 ? '#cbd3ec' : '#7f8aa6'), whiteSpace: 'pre', opacity: ou, transform: `translateX(${(ou - 1) * -10}px)` }}>
                          {o}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { SHOTS, PROMO_TOTAL, CAPTIONS } from './SHOTS';
import { SceneOpen } from './live/SceneOpen';
import { SceneGraze } from './live/SceneGraze';
import { SceneDeck } from './live/SceneDeck';
import { SceneCarry } from './live/SceneCarry';
import { SceneTerminal } from './live/SceneTerminal';
import { SceneFiles } from './live/SceneFiles';
import { SceneSegmented } from './live/SceneSegmented';
import { SceneOutro } from './live/SceneOutro';
import { PromoCaption } from './PromoCaption';

// ---------------------------------------------------------------------------
// Sound design — declarative SFX pin table. Every `from` is a RELATIVE SHOTS
// anchor + offset (never a bare frame number), so a timeline shift auto-moves
// the beats. Long assets carry an explicit durationInFrames to be truncated.
// ---------------------------------------------------------------------------
type SFX = { from: number; src: string; volume: number; duration?: number; note: string };

const SFX: SFX[] = [
  // S1 brand open
  { from: SHOTS.s1.from + 12, src: 'transition-soft.mp3', volume: 0.4, note: 'crosshair draw / wordmark landing' },
  { from: SHOTS.s1.from + 78, src: 'whoosh-fast.mp3', volume: 0.45, duration: 40, note: 'brand dissolve -> S2' },
  // S2 graze: whoosh on camera tilt-up + bubble settle pops
  { from: SHOTS.s2.from, src: 'whoosh-big.mp3', volume: 0.42, duration: 90, note: 'camera tilts up into the phone' },
  { from: SHOTS.s2.from + 83, src: 'typewriter-hit-single.mp3', volume: 0.3, duration: 30, note: 'bubble settle pops (sparse)' },
  // S3 deck deal: whooshes as cards fly, a pop per landing (2 cards) + progress
  { from: SHOTS.s3.from, src: 'transition-soft.mp3', volume: 0.35, note: 'into the phone' },
  { from: SHOTS.s3.from + 6, src: 'whoosh-fast.mp3', volume: 0.42, note: 'card 1 deals in' },
  { from: SHOTS.s3.from + 20, src: 'whoosh-fast.mp3', volume: 0.36, note: 'card 2 deals in' },
  { from: SHOTS.s3.from + 16, src: 'transition-snap.mp3', volume: 0.4, note: 'card 1 settle' },
  { from: SHOTS.s3.from + 30, src: 'transition-snap.mp3', volume: 0.38, note: 'card 2 settle' },
  { from: SHOTS.s3.from + 80, src: 'sweep-fast.mp3', volume: 0.4, duration: 40, note: 'progress bar reaches full (S3->T1 hand-off)' },
  // T1 line-carry: pen stroke + a light knock as the frame closes
  { from: SHOTS.t1.from, src: 'marker-pen-line.mp3', volume: 0.5, duration: 30, note: 'progress line extends / carries' },
  { from: SHOTS.t1.from + 62, src: 'transition-snap.mp3', volume: 0.42, note: 'frame corner turns' },
  { from: SHOTS.t1.from + 78, src: 'typewriter-hit-single.mp3', volume: 0.34, duration: 16, note: 'question card content in' },
  // S4 terminal: whoosh on flights + mech/typing + click approval
  { from: SHOTS.s4.from, src: 'whoosh-big.mp3', volume: 0.45, duration: 90, note: 'into 3D terminal space' },
  { from: SHOTS.s4.from + 62, src: 'whoosh-fast.mp3', volume: 0.4, note: '2nd flight' },
  { from: SHOTS.s4.from + 124, src: 'whoosh-fast.mp3', volume: 0.36, note: '3rd flight' },
  { from: SHOTS.s4.from + 10, src: 'keyboard.mp3', volume: 0.34, duration: 110, note: 'typing across windows' },
  { from: SHOTS.s4.from + 145, src: 'click-camera.mp3', volume: 0.5, note: 'approval applied on computer' },
  // S5 files: whoosh on camera right + paper slide
  { from: SHOTS.s5.from, src: 'whoosh-big.mp3', volume: 0.42, duration: 90, note: 'camera rights onto files' },
  { from: SHOTS.s5.from + 20, src: 'paper-slide.mp3', volume: 0.4, duration: 40, note: 'file rows pour in' },
  // S6 segmented: a real switch sound + pop for the icon/thumb
  { from: SHOTS.s6.from + 40, src: 'switch-click-quick.mp3', volume: 0.5, note: 'tap on the control' },
  { from: SHOTS.s6.from + 52, src: 'switch-tap.mp3', volume: 0.4, note: 'thumb slides' },
  { from: SHOTS.s6.from + 54, src: 'pop.mp3', volume: 0.4, note: 'model icon pops' },
  // S7 outro: riser -> impact (wordmark lock, full volume peak) -> sparkle
  { from: SHOTS.s7.from, src: 'whoosh-fast.mp3', volume: 0.3, note: 'into deep space' },
  { from: SHOTS.s7.from + 52, src: 'riser-cine.mp3', volume: 0.5, duration: 40, note: 'rise into the network' },
  { from: SHOTS.s7.from + 88, src: 'impact-deep-whoosh.mp3', volume: 0.55, duration: 90, note: 'wordmark impact (SFX peak)' },
  { from: SHOTS.s7.from + 100, src: 'sparkle.mp3', volume: 0.32, duration: 90, note: 'sparkle tail' },
];

// The used src set (deduped for the placeholder removal check).
const USED_SRC = new Set(SFX.filter((s) => s.volume > 0).map((s) => s.src));

const Bgm: React.FC = () => {
  const frame = useCurrentFrame();
  const from = 0;
  const to = PROMO_TOTAL;
  const vol = interpolate(frame, [0, 30, to - 50, to], [0, 0.34, 0.34, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return <Audio src={staticFile('audio/bgm.mp3')} volume={vol} />;
};

type PromoProps = {
  bgm?: boolean;
};

export const PromoMain: React.FC<PromoProps> = ({ bgm = true }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0C10' }}>
      {/* BGM bed gated by the `bgm` inputProp (true by default; render --props
          {"bgm":false} for the no-BGM version that keeps all SFX) */}
      {bgm ? <Bgm /> : null}

      {/* SFX pin table */}
      {SFX.filter((s) => s.volume > 0 && USED_SRC.has(s.src)).map((s, i) => (
        <Sequence
          key={`sfx-${i}`}
          from={s.from}
          // long assets get explicit truncation; keep 90f default for ≤3s media
          durationInFrames={s.duration ?? 90}
        >
          <Audio src={staticFile(`audio/${s.src}`)} volume={s.volume} />
        </Sequence>
      ))}

      {/* ---- shots ---- */}
      <Sequence from={SHOTS.s1.from} durationInFrames={SHOTS.s1.duration}>
        <SceneOpen />
      </Sequence>
      <Sequence from={SHOTS.s2.from} durationInFrames={SHOTS.s2.duration}>
        <SceneGraze />
      </Sequence>
      <Sequence from={SHOTS.s3.from} durationInFrames={SHOTS.s3.duration}>
        <SceneDeck />
      </Sequence>
      <Sequence from={SHOTS.t1.from} durationInFrames={SHOTS.t1.duration}>
        <SceneCarry />
      </Sequence>
      <Sequence from={SHOTS.s4.from} durationInFrames={SHOTS.s4.duration}>
        <SceneTerminal />
      </Sequence>
      <Sequence from={SHOTS.s5.from} durationInFrames={SHOTS.s5.duration}>
        <SceneFiles />
      </Sequence>
      <Sequence from={SHOTS.s6.from} durationInFrames={SHOTS.s6.duration}>
        <SceneSegmented />
      </Sequence>
      <Sequence from={SHOTS.s7.from} durationInFrames={SHOTS.s7.duration}>
        <SceneOutro />
      </Sequence>

      {/* ---- bilingual captions over each live shot ---- */}
      {CAPTIONS.map((c) => (
        <Sequence key={c.from} from={c.from} durationInFrames={c.duration}>
          <PromoCaption en={c.en} cn={c.cn} duration={c.duration} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

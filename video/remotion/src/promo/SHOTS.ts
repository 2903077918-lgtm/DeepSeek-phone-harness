// Frame timeline for the DeepSeek Phone Harness promo (931f @30fps, 1920x1080).
// All SFX from-flags reference these relative frame anchors (never bare numbers).
export const SHOTS = {
  // S1 brand-ink-open
  s1: { from: 0, duration: 84 }, // 0-83
  // S2 graze-face-tour (chat page)
  s2: { from: 84, duration: 120 }, // 84-203
  // S3 deck-deal-flyin (tool cards)
  s3: { from: 204, duration: 88 }, // 204-291
  // T1 line-carry-transition
  t1: { from: 291, duration: 120 }, // 291-410
  // S4 terminal-3d
  s4: { from: 411, duration: 150 }, // 411-560
  // S5 overhead tilt-reveal (files)
  s5: { from: 561, duration: 120 }, // 561-680
  // S6 segmented-thumb-hero
  s6: { from: 681, duration: 110 }, // 681-790
  // S7 deep-space outro
  s7: { from: 791, duration: 140 }, // 791-930
} as const;

export const PROMO_TOTAL = 931;

// Bilingual captions (EN primary + CN secondary) whose durations match each
// shot in the spec's subtitle table.
export type CaptionDef = {
  from: number;
  duration: number;
  en: string;
  cn: string;
};

export const CAPTIONS: CaptionDef[] = [
  { from: 84, duration: 120, en: 'Your agent. On your phone.', cn: '手机遥控电脑上的 Agent' },
  { from: 204, duration: 88, en: 'Watch every step on the computer', cn: '电脑上的每一步，手机上看得见' },
  { from: 291, duration: 120, en: "Answer. Don't wait.", cn: '回答它，别干等' },
  { from: 411, duration: 150, en: 'Your computer, at your fingertips', cn: '电脑，就在指尖' },
  { from: 561, duration: 120, en: 'Your files, in your pocket', cn: '文件，随身带走' },
  { from: 681, duration: 110, en: 'Models, one tap away', cn: '模型，一点即换' },
];

// A decorative DeepSeek Phone — the floating portrait handset that every live
// shot of the phone UI lives inside. Real 2x page textures are laid inside it
// at CSS size (393x852) so they rasterize sharp under 3D (Q2). The frame is a
// hand-drawn rounded bezel with a thin gold edge (the only brand accent) and a
// top-notch camera island. Positioned in page CSS coordinates; callers scale /
// transform the whole group.
import React from 'react';

const GOLD = '#C9A227';

export const PHONE_W = 393;
export const PHONE_H = 852;
export const PHONE_R = 44; // corner radius (CSS)

// The phone screen contents live in a 393x852 box. This wrapper draws the
// outer bezel + gold edge + notch, and clips its children to the screen.
export const PhoneShell: React.FC<{
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ style, children }) => (
  <div
    style={{
      width: PHONE_W,
      height: PHONE_H,
      borderRadius: PHONE_R,
      position: 'relative',
      padding: 10, // outer bezel ring
      boxSizing: 'border-box',
      background:
        'linear-gradient(160deg, #2A2A2A 0%, #1a1a1a 100%)',
      boxShadow:
        `0 0 0 1px rgba(201,162,39,0.55), 0 0 0 2px rgba(0,0,0,0.8), 0 40px 90px rgba(0,0,0,0.65), 0 0 46px rgba(201,162,39,0.16)`,
      ...style,
    }}
  >
    {/* gold edge glint at the top-left highlight */}
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: PHONE_R,
        background: 'linear-gradient(125deg, rgba(201,162,39,0.4), transparent 34%)',
        opacity: 0.35, pointerEvents: 'none',
      }}
    />
    {/* screen clip */}
    <div
      style={{
        position: 'absolute', inset: 10, borderRadius: PHONE_R - 10, overflow: 'hidden',
        background: '#0B0C10',
      }}
    >
      {children}
      {/* status-bar notch pill */}
      <div
        style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          width: 96, height: 22, borderRadius: 11, background: 'rgba(0,0,0,0.9)',
          border: '1px solid rgba(201,162,39,0.25)', boxSizing: 'border-box',
          zIndex: 20,
        }}
      />
    </div>
  </div>
);

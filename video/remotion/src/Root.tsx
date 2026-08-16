import { Composition } from 'remotion';
import { PromoMain } from './promo/Main';
import { PROMO_TOTAL } from './promo/SHOTS';

export const Root: React.FC = () => {
  return (
    <Composition
      id="Promo"
      component={PromoMain}
      durationInFrames={PROMO_TOTAL}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};

import { Features } from 'lightningcss';

export const stylexOptions = {
  useCSSLayers: false,
  lightningcssOptions: {
    // color-scheme is owned by index.css and the theme bootstrap, not StyleX's
    // extracted stylesheet. Lowering light-dark() in isolation emits fallback
    // variables without their definitions, invalidating component colors.
    exclude: Features.LightDark,
  },
};

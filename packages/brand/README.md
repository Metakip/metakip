# Metakip Brand

The source of truth for Metakip's foundational brand assets and design decisions.
This package currently covers logos, typography, and colors; it does not contain
UI components.

## Contents

- `assets/logos/metakip.svg`: canonical Metakip mark.
- `assets/fonts/`: desktop Inter font files and the SIL Open Font License.
- `fonts.css`: shared web entry point for Inter.
- `tokens/typography.json`: product font families and weights.
- `tokens/colors.json`: product neutrals, link colors, and marketing neutrals.
- `colors.css` and `colors.rs`: generated platform exports from the color tokens.

`tokens/colors.json` is the source of truth. The CSS and Rust files are generated
exports; do not edit them directly. Define shared neutral hex values under
`neutral` and point product roles at them with references like
`{neutral.zinc.50}`. References must point directly to a hex value. Regenerate
platform exports after changing color tokens:

```sh
pnpm --filter @metakip/brand generate:colors
```

## Logo

Use the mark on a light background, including in dark mode. After editing
`assets/logos/metakip.svg`, run:

```sh
pnpm --filter @metakip/brand generate:brand-assets
```

The brand package owns generation and validation of these assets. Its command
copies the SVG to the marketing site's public directory, renders
the matching PNG on white, and packages both in the ZIP. It also renders the
transparent marketing mark, the app favicons, and the touch icon from the same
SVG. Output locations remain in the consuming packages; their imports and public
URLs do not change. CI runs `pnpm --filter @metakip/brand check:brand-assets` to
verify that the generated files match the canonical artwork.

## Typography

Inter is the product UI sans-serif. The web and marketing sites import
`@metakip/brand/fonts.css`, which uses Fontsource's WOFF2 subsets so browsers
fetch only the scripts they need. Desktop uses the 400/500/600/700 TTF faces,
distributed under the SIL Open Font License in `assets/fonts/OFL.txt`.
Code uses the platform monospace font.

## Colors

The product tokens define the shared neutral light/dark palette and blue link
colors, including hover shades. Marketing keeps its separate light/dark
neutrals and monochrome links. Existing loading/status and destructive colors
remain specialized app colors and are not changed by these foundational tokens.
The web app, docs, marketing site, and desktop app consume generated platform
exports for the tokens they share; feature-specific colors remain local.

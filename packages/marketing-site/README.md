# Marketing site

## Brand assets

The brand-asset generator centers the mark with a safe inset on a transparent 512×512 source
canvas. The SVGs stay transparent; the light PNG has a white background and the dark PNG has a
charcoal background, with the dark mark recolored white. It also rebuilds the all-assets archive.
Run it with:

```sh
pnpm --filter @metakip/marketing-site generate:brand-assets
```

The command requires the `zip` utility. The generated files are written to `public/` and served as
ordinary static assets.

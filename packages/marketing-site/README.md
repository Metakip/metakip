# Marketing site

## Brand assets

The transparent PNGs are generated from `src/assets/metakip-mark.png`, with the dark version
recolored white. Regenerate those PNGs and the all-assets archive with:

```sh
pnpm --filter @metakip/marketing-site generate:brand-assets
```

The command requires the `zip` utility. The generated files are written to `public/` and served as
ordinary static assets.

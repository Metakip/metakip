# Marketing site

## Brand assets

The brand package's asset generator uses the canonical 512×512 SVG from
`packages/brand/assets/logos/metakip.svg`. It publishes the transparent SVG and
a PNG on white, both individually and in a ZIP. Run it with:

```sh
pnpm --filter @metakip/brand generate:brand-assets
```

The downloads are served from `public/` as static assets. The command also
refreshes the transparent marketing PNG and shared app favicons. The asset
check compares the files inside the ZIP, ignoring ZIP timestamps and permissions.

# App Favicon Assets

These files are generated from the canonical Metakip mark in
`packages/brand/assets/logos/metakip.svg`. Regenerate them with:

```sh
pnpm --filter @metakip/brand generate:brand-assets
```

The same icons are used in both themes. Each site imports the generated files
into its own build, so local development and deployments do not depend on
another site's asset host.

# Hero visual assets

`hero-human-retro.png` was edited with the built-in image generation tool from the existing `hero-human.png`. At the user's clarification, it preserves the original bald figure's silhouette, pose, proportions, shoulder crop, and composition, changing only the rendering to retro pixel art. The alternate short-haired character (`hero-human-pixel.png`) is unused.

Prompt: Edit the supplied transparent figure into chunky 8-bit retro pixel art. Preserve the same bald man, exact right-facing downward head pose, outer silhouette, anatomy, shoulder crop, ear position, facial feature placement, proportions, composition, and empty transparent area on the right. Change only the rendering style; do not add hair, clothing, decorations, logos, or text. Keep warm off-white and dark charcoal with a few flat gray shades. Rebuild contours as stepped square pixels and crosshatching as coarse clusters and checkerboard dithering. Aim for 80-100 pixels across the head with nearest-neighbor edges. Maintain transparent alpha and the original canvas aspect ratio.

The illustration has a transparent PNG source, high-quality WebP delivery, and pixelated rendering. Connections are rendered separately so they scale with the agent nodes. A pixel-art style transformation does not by itself establish copyright clearance.

Logo sources:

- Pi: https://pi.dev/favicon.svg (official monochrome mark, fixed to ink on its light icon tile).
- Cursor: https://cursor.com/marketing-static/favicon-light.svg
- Claude: https://claude.ai/favicon.svg (official terracotta mark).
- ChatGPT uses the OpenAI mark: https://github.com/simple-icons/simple-icons/blob/13.21.0/icons/openai.svg
- OpenCode: https://opencode.ai/favicon.svg
- Grok: https://grok.com/images/favicon.svg
- Antigravity: https://www.antigravity.google/assets/image/brand/antigravity-icon__full-color.svg
- Muse (Meta): https://introducing.muse.ai/icon.svg (official blue gradient mark).
- Hermes Agent's Nous Girl mark is served locally from `public/agents/nous-girl.png`;
  source: https://github.com/NousResearch/hermes-agent/blob/a036b13793a2275a71617d4e9bc2b7a78b2be42d/apps/desktop/public/nous-girl.png.
- OpenClaw: static local adaptation of https://unpkg.com/openclaw@latest/dist/control-ui/favicon.svg.

SVG assets are served locally from `public/agents/`. Original brand colors are retained, including monochrome for brands whose official marks are monochrome. Branches share a single trunk and use matching 45-degree diagonals with softened corners; icon centers and connector destinations come from the same coordinates.

`hero-workspace-light.png` and `hero-workspace-dark.png` are illustrative workspace mockups created with the built-in image generation tool, using frames of the existing collaboration recordings as structure references.

Mockup prompt: Adapt the product screenshot to Metakip branding in a landscape 16:9 knowledge editor with Geist typography. Include a sidebar with Project notes, Research, Meeting notes, Ideas, and Archive; a Project notes page with Product and Planning tags; the sentence "Keep the context here. Build on it together."; three next steps; and an orange Claude collaborator caret. Use paper and ink in light mode, off-black and off-white in dark mode, and orange (#ff6b2b) as the only accent. No metrics, gradients, old branding, or terminal overlay.

The terminal overlay is a real CLI command example, not a fabricated live agent session. The screenshots are illustrative, not evidence of a running agent integration.

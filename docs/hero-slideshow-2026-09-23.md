# Homepage hero slideshow

## Scope

Replace the homepage hero photograph with three people-free scenes: a wedding,
a Class of 2027 graduation party, and a birthday. Preserve the existing headline,
calls to action, branding, service images, and gallery.

## Assets and provenance

Generated with Higgsfield Recraft V4.1, standard 2K landscape, on September 23,
2026 (September 24 UTC). Three generations used 24 credits total; the reported
balance changed from 5445.5 to 5421.5. No video generation or additional purchases.

| Scene | Project asset | Generation ID |
| --- | --- | --- |
| Wedding | assets/hero-wedding-higgsfield.webp | 3d14fe40-065b-4876-873b-9a78afbca87d |
| Graduation | assets/hero-graduation-2027-higgsfield.webp | c21bc0a9-a4b6-43bf-92b1-8c55d63da8db |
| Birthday | assets/hero-birthday-higgsfield.webp | 34fbd4b6-f0e4-426d-b315-83d0d24bb037 |

Direction: realistic upscale event settings, warm ivory/plum/gold palette,
unoccupied venues, open darker space on the left for website copy. Wedding uses
candlelight, ivory flowers and chandeliers; graduation includes a legible Class
of 2027 sign, cap and diploma; birthday uses a candle-topped cake and balloons.
Generated PNGs were optimized to 1920px-wide WebP at quality 83.

## Interaction and accessibility

- 7.5-second slide interval, 1.6-second crossfade, gentle 20-second zoom.
- Stationary headline and inquiry links.
- Manual scene selection pauses autoplay; a labeled play/pause control resumes it.
- Autoplay pauses on mouse hover, keyboard interaction, hidden tabs and offscreen.
- Reduced-motion preference disables automatic playback, zoom and crossfade.
- Failed next-image decoding keeps the current scene visible.
- Descriptive alternative text, selected-state buttons, visible keyboard focus.
- The first wedding scene remains visible without JavaScript.
- Mobile uses its existing separate photograph/copy layout and tailored crops.

## Verification

- 57 Node tests passed, including four slideshow regression tests.
- `npm run build` passed; `git diff --check` passed.
- Browser screenshots inspected at 1440px desktop and 390px mobile.
- No horizontal overflow at 375, 768, 1024 and 1440px.
- Browser reduced-motion check confirms no image animation and paused playback.
- Browser autoplay advanced to graduation after moving the pointer off the hero;
  manual selection paused playback as intended. Desktop shading protects text contrast.
- Local static-server review API 404 is expected; backend was not changed.

## Release

Prepared on `codex/seamless-page-scroll`. Production has not been deployed;
the website workflow requires preview approval before publication.

# Hero playback and baby-shower service image

User approved removing the entire hero scene-control row and fixing desktop
autoplay. The pointer previously paused playback across the full hero. Mouse
hover no longer pauses it; keyboard focus suspends it only while a hero link is
focused. Hidden tabs and offscreen heroes still suspend playback. Reduced-motion
preferences still disable autoplay and animation. An unobtrusive footer button
retains a way to pause or resume, without controls over the hero photograph.

The Services directory's Guest Seating Experience image now shows two white,
landscape-screen check-in kiosks in a baby-shower setting. Mobile displays the
full 3:2 frame so the equipment is not cropped. Other service images are unchanged.

## Image provenance

Generated with the built-in image-generation tool; reference equipment image:
`assets/guest-check-in-kiosks.webp`. Saved asset:
`assets/guest-check-in-baby-shower.webp` (1536 × 1024, WebP quality 84).

Final generation prompt:

> Use case: photorealistic-natural. Create one premium website service-card photograph, landscape 3:2. Reference image is equipment reference only: preserve the believable white freestanding guest check-in kiosks with landscape-format 27–32 inch screens and sturdy white pedestal bases; not tall portrait advertising signage. New scene: elegant intimate baby shower reception entrance, soft warm natural daylight, cream and muted sage decor, restrained blush accents, tasteful small floral arrangement and soft balloon grouping in the background, beautifully set tables visible beyond. Show two of the reference-style kiosks, fully visible including bases, as the main subject centered with comfortable crop margins. Screens have simple refined interface with exact readable text 'WELCOME' and smaller 'Please check in'. Photographic realistic materials, refined hospitality advertising composition, no people, no babies, no watermark, no giant overlay text. This is a new baby-shower setting, not a corporate ballroom; keep the actual equipment style faithful to the reference.

## Verification

- 77 Node tests passed; frontend and function builds passed.
- Browser verified desktop autoplay advances with the pointer inside the hero.
- Mobile and desktop screenshots reviewed; no hero captions or playback button.
- Reduced-motion, keyboard focus, footer playback, hidden/offscreen suspension,
  and failed image decoding covered by regression tests.

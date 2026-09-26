# strata: design

**This UI must be striking and must not look AI-generated.** It sits next to `portfolio`, `tidewatch`, and `afterglow`,
and shares their DNA: a dark ground, warm type, a thin fixed HUD over a full-bleed scene, hairline edges, one reserved signal
colour, mono for every number. No 3D. The scene here is **the map itself**, and the old maps are the only colour on screen.

## Concept: a surveyor's instrument over a core sample

The city is a stack of layers (strata). The slider is a surveyor's ruler that only has notches where history exists.
The "what stood here" panel is a **core sample**: a vertical column where each building's lifespan is a band, and a hairline
marks the year you're looking at.

**Key idea:** the modern base map is almost invisible (dark, desaturated, low contrast), so the sepia/hand-coloured historical
maps pop. History supplies the colour; the present stays grey.

## Palette

| Token | Value | Rule |
|---|---|---|
| `--night` | `#07090B` | ground, and the base-map land fill |
| `--vellum` | `#EFE9DD` | primary type |
| `--slate` | `#98A0A8` | secondary type, base-map labels, the ruler's minor ticks |
| `--hair` | `rgba(239,233,221,.08)` | rules, panel edges, base-map roads. Never brighter |
| `--survey` | `#F2A93B` | **"now" only**: the selected year numeral, the ruler's current notch, the location pin, the core sample's year line. Nothing else |
| `--error` | `#C9A27A` | the ±N m accuracy readout and the accuracy halo around the pin |

The historical tiles keep their own colours. Never tint or filter them; they're the content.

## Type

- **Fraunces** (variable; optical size, softness, and "WONK" axes): the year numeral and place names. At large sizes, with a high
  optical size and a little softness, it reads like an engraved map title. The year is set **huge**: clamp(96px, 16vw, 220px).
- **IBM Plex Mono**: coordinates, ±error, scale (`1:600`), license, and counts. Tabular numbers.
- **Instrument Sans**: controls and body copy.
- Self-host with `@fontsource/*` (npm, bundled). No CDN fonts.

## Base map
- Vector tiles (Protomaps PMTiles or MapTiler) with a **custom style written in this repo** (`web/style/base.json`): land `--night`,
  water slightly lighter (`#0C1114`), roads as `--hair` lines, building footprints faint, labels in `--slate` Instrument Sans
  at small caps. No POI icons.
- Include a toggle to hide modern labels entirely (`B`) so you see only the past.

## Screens

### 1. Arrival (empty state)
- The full-bleed dark base map drifts very slowly (a 30 s pan, off under reduced motion).
- Top left: a small mark and `STRATA` in mono, letter-spaced. Centre left: a serif line, *What stood here?*, and one
  address input with a mono placeholder `350 5th Avenue, New York`.
- 3–4 sample addresses as dashed-underline mono buttons, each chosen because its history is dramatic.

### 2. Located
- The camera flies to the address (eased, 1.2 s), and the pin drops in `--survey` with a faint `--error` accuracy halo whose
  radius equals the layer's `rmse_m`. It's an honest visual of how precise the alignment is.
- **The year numeral** appears huge in the bottom left, in Fraunces. Changing year rolls the digits like an odometer (each
  digit slides, 220 ms).
- **The ruler** (bottom, full width): a hairline with major ticks per decade in `--slate` mono and **notches only at years that
  have maps**. The density of notches visibly shows the coverage. Drag, click a notch, or use `←/→` to jump between available years.
  The current notch is `--survey`.
- **Layer change** crossfades two raster layers (keep the old one loaded, animate `raster-opacity` over 400 ms) and never pops.
  Preload the neighbouring years' tiles.
- **Swipe compare** (`C`): a vertical hairline divider with a small handle labelled `1916 │ 2026` in mono. Drag it across the city.
- **Layer card** (a thin panel, top right): map title in serif, then mono readouts: `1:600 · ±6 m · poly1 · PUBLIC DOMAIN · LOC`,
  plus a source link. When several maps exist for one year, a quiet list lets you pick one.

### 3. Core sample (right drawer, `I`)
- A vertical time column (1800 → today, top → bottom). Each nearby building or place from Wikidata/OpenHistoricalMap is a
  thin band spanning its start → end years, labelled in serif. Demolished buildings end in a small hairline cap.
- A horizontal `--survey` hairline marks the selected year. Bands it crosses are `--vellum`; the rest are `--slate`.
- Clicking a band jumps the ruler to that building's first map year.
- Example: at 350 5th Ave, the Waldorf-Astoria band (1893–1929) ends right where the Empire State Building band (1931–) begins.
  That handover is the story this panel tells.

### 4. Share
The URL holds `?q=&lat=&lon=&z=&year=&swipe=`. A PNG export (`P`) renders the map canvas plus the year numeral, address, and source
credit as a poster.

## Motion
- UI 120–220 ms; camera flights 900–1400 ms; layer crossfade 400 ms. One easing: `cubic-bezier(.2,.7,.2,1)`.
- `prefers-reduced-motion` turns off the drift, the odometer, and the flights (they become jumps) and makes the crossfade instant.

## Keyboard
`/` focus address · `←/→` previous/next available year · `Shift+←/→` ±1 decade · `C` swipe compare · `I` core sample ·
`B` hide modern labels · `O` / `Shift+O` opacity ± · `P` export · `?` help · `Esc` close. Every control has a visible focus ring.

## Layout
Verify at 360, 390, 768, 1024, 1440, and 1920 widths and in landscape phones. On mobile the year numeral shrinks to the top bar, the ruler
stays at the bottom (it's thumb territory, with 44px touch targets on the notches), and the core sample is a bottom sheet. Honour safe-area insets.
The map owns gestures; the page never scrolls. Dark only, by design (document this).

## Anti-"AI look" rules (a reviewer rejects any of these)
- No purple/blue gradients, gradient text, neon glows, or glassmorphism card stacks. Panels are near-solid `--night` at 88% with a hairline edge
  and at most one restrained blur.
- No default MapLibre or OSM look. The base style is ours. No default zoom-control chrome (restyle it or use keyboard and gestures).
- No emoji icons, no ✨, no generic Tailwind cards, no Inter-everywhere, no skeleton shimmer.
- No filler copy. Specific and honest: "3 maps cover this spot · 1857, 1916, 1955", "±40 m: hand-drawn 1850 plan".
- Few icons, custom SVG, 1.5px stroke.

## Quality bar (definition of done for any UI task)
- WCAG AA contrast for all UI text (the map imagery is exempt, but text over the map always sits on a panel).
- Full keyboard use; the ruler is an ARIA slider whose `aria-valuetext` is "1916, Sanborn atlas, 3 maps".
- Lighthouse on the arrival page: Performance ≥ 90, Accessibility = 100.
- No console errors (CORS on tile sources!) and no layout shift when panels load.
- Screenshots at 390 and 1440 wide are saved to `docs/screenshots/<milestone>/` and compared against this doc before ticking the task.

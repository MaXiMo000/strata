# strata: build plan

Each phase ends with something demo-able. A session picking up this repo starts at the first unticked task.

## Product in one line

Address + year → the best historical map layer(s) for that spot, aligned over today's map, with the positional
error in meters, the source/license, and "what stood here" facts.

## Non-negotiables

- **Every layer stores its license.** Rumsey = CC BY-NC-SA (non-commercial). Filter on `license` before any monetisation.
- **Every layer shows its error** (`rmse_m`, leave-one-out). Users trust a map that admits "±40 m".
- **Year = survey year** where known, not publication year. Record both.
- **Pilot city: New York City** (densest free coverage: NYPL + LOC Sanborn + USGS). Don't expand until NYC is good.
- **Don't host what you don't have to**: prefer Allmaps (warps IIIF on the fly) and source-hosted tiles over your own storage.
- **Tile sources must send CORS headers.** MapLibre fetches tiles with `fetch()`, so a server without
  `Access-Control-Allow-Origin` shows nothing. (OpenTopoMap, for example, fails this.) Check with
  `curl -I` before adding a source; proxy it through TiTiler if needed.

---

## Phase 0: Scaffold (done)

- [x] PostGIS schema (`maps`, `gcps`), docker compose (PostGIS; TiTiler under the `tiles` profile)
- [x] API: `/api/timeline`, `/api/layers` (ranking in SQL), `/api/whatwashere` (Wikidata P571/P576)
- [x] `strata/georef.py`: affine fit, residuals in ground meters, leave-one-out RMSE, worst GCP, GDAL commands
- [x] `web/index.html`: MapLibre, Photon geocoding, year slider snapping to available years, opacity, facts list
- [x] Verified end-to-end in a browser with throwaway test rows (350 5th Ave: 1916 → Waldorf-Astoria)

---

## Phase 1: NYC MVP with pre-georeferenced maps (2–3 weeks)

Goal: type any Manhattan address and get **≥ 4 distinct years** of real historical layers.

### 1a. Ingest framework
- [x] `strata/ingest/__init__.py`: `upsert_map(conn, dict)` + `upsert_gcps(conn, map_id, rows)`; idempotent on `id`.
      Also `get()`/`get_json()`: User-Agent, ~1 req/s, on-disk cache in `data/cache/`; `check_map` refuses rows without license/year/footprint/tile_url
- [x] `python -m strata.ingest <source> [--bbox=minlon,minlat,maxlon,maxlat]` CLI (argparse, no framework)
- [x] Test: upserting the same map twice leaves one row (needs a test DB, so use `DATABASE_URL` from env and skip if it's missing)

### 1b. NYPL Map Warper (already georeferenced, public domain)
> **Drift (2026-10-02):** NYPL archived Map Warper in April 2021; `maps.nypl.org/warper` (API and tiles) now redirects to
> Archive-It. The work survives in NYPL's Space/Time dataset (title, year, image id) and in Allmaps (live GCPs, warped
> masks), so the ingester joins the two on the NYPL image id. Atlas layers aren't in Allmaps; sheets are ingested
> one by one (Phase 2 groups them by `atlas_id`).
- [x] `strata/ingest/nypl_warper.py`: dated maps from `mapwarper.objects.ndjson` overlapping the bbox → Allmaps
      `api.allmaps.org/images/<sha1(iiif url)[:16]>/maps.geojson` → footprint = Allmaps' warped mask, GCPs, transformation.
      `georef_annotation` = the Allmaps map; `tile_url` = `allmaps.xyz/maps/<id>/{z}/{x}/{y}.png` (CORS `*`, but see 1e: it
      renders NYPL/LOC blank, so the browser warps them itself). License: pre-1931 → `public-domain`, later →
      `nypl-rights-unverified` (per-item rights need an NYPL API token).
- [x] Compute `rmse_m` with `georef.loo_rmse_m` from the imported GCPs; `method` from the Allmaps transformation.
      Quality gate for every source (`ingest.MAX_RMSE_M = 100`): maps with < 4 GCPs or LOO RMSE > 100 m are skipped.
      The NYPL set includes continent maps whose footprint covers NYC (errors of 10 km+).

### 1c. USGS historical topographic maps (already georeferenced GeoTIFFs)
- [x] `strata/ingest/usgs_topo.py`: TNM Access API (`products?datasets=Historical Topographic Maps&bbox=…`, paged by 500)
      → 381 NYC products. **No download:** the GeoTIFFs on `prd-tnm.s3.amazonaws.com` are already valid COGs, so TiTiler
      reads them in place. The collar is cropped in the tile URL with a GDAL connection string,
      `url=vrt:///vsicurl/<tif>?projwin=<neatline>&projwin_srs=EPSG:4267`. Footprint = the neatline (TNM `boundingBox`).
      Year = Survey → Field Check → Aerial Photo → Date on Map from the FGDC metadata; `year_published` = Imprint Year.
      TiTiler runs with `PROJ_NETWORK=ON` so NAD27 → WGS84 uses the NADCON grid (otherwise a 7–20 m ballpark shift).
- [x] `rmse_m` = NMAS (`scale × 1/50 inch`: 1:24k ≈ 12 m, 1:62,500 ≈ 32 m), `method='pre-georeferenced'`. The 100 m gate
      drops 1:250,000 sheets. 356 maps, 1884–1997.

### 1d. Allmaps annotations
- [ ] `strata/ingest/allmaps.py`: import Georeference Annotations for NYC maps (LOC, NYPL, and Rumsey maps others have
      already georeferenced in Allmaps). Search: `api.allmaps.org/maps.geojson?intersects=<lat>,<lon>&imageServiceDomain=…`
      (lat first; max 200 results, no paging, so query a grid). Skip `iiif.nypl.org` (1b has it with dates). The year
      must come from the source's IIIF manifest / catalogue record. GCPs come from the annotation; compute `rmse_m`.

### 1e. Design build. **The UI must be striking, not AI-looking.** The spec is docs/DESIGN.md.
- [ ] `web/` becomes **Vite + TypeScript** (no UI framework; MapLibre + `@allmaps/maplibre` do the heavy lifting). FastAPI serves `web/dist`; Vite proxies `/api` in dev
- [ ] Tokens (`web/src/tokens.css`): the six colours with their measured contrast ratios in comments, a type scale, 4px spacing, motion, z-layers.
      Fonts self-hosted: `@fontsource-variable/fraunces`, `@fontsource/ibm-plex-mono`, `@fontsource/instrument-sans`
- [ ] Custom dark vector base style `web/style/base.json` (Protomaps PMTiles or MapTiler; production-licensed; replaces OSM raster tiles),
      with a `B` toggle to hide modern labels
- [ ] Arrival screen (slow drift, serif question, sample addresses)
- [ ] Year numeral (Fraunces, huge, odometer roll) + **the ruler** (notches only at available years; ARIA slider; `←/→` jumps)
- [ ] Layer crossfade (two layers, 400 ms: `WarpedMapLayer.setOpacity` for Allmaps maps, `raster-opacity` for XYZ) + preloading of neighbouring years; the pin plus an accuracy halo sized by `rmse_m`
- [ ] Layer card (serif title + mono readouts + source/license) and a picker when several maps share a year
- [ ] Swipe compare (`C`) with the `1916 │ 2026` handle
- [ ] URL state `?q=&lat=&lon=&z=&year=&swipe=`; PNG poster export (`P`)
- [ ] Mobile layout (360/390, landscape, safe areas); keyboard map + `?` overlay
- [ ] Screenshots at 390 and 1440 in `docs/screenshots/1e/`, self-reviewed against the DESIGN.md anti-"AI look" list. Fix anything that fails before ticking

**Acceptance:** 5 random Manhattan addresses each show ≥ 4 years; every layer shows its error + license; no CORS errors;
Lighthouse Accessibility 100 / Performance ≥ 90; nothing from the anti-"AI look" list present.

---

## Phase 2: Sanborn maps (2–4 weeks)

Goal: building-level detail (the "what stood at this address" answer).

- [ ] `strata/ingest/loc_sanborn.py`: LOC JSON API, e.g. `https://www.loc.gov/collections/sanborn-maps/?fa=location:new+york&fo=json`
      → items → IIIF manifests. Store sheets with `atlas_id` (volume + year). Rights: pre-1931 US publication = public domain.
      Check each item's rights field anyway.
- [ ] Georeference the sheets for **one Manhattan atlas volume** (~50–100 sheets) in Allmaps Editor (manual, ~3–5 min/sheet
      with street-corner GCPs). Import the annotations with the 1d ingester.
- [ ] Mosaic: one layer per `atlas_id`. Allmaps renders multiple annotations as one tile layer. For TiTiler, build
      a GDAL VRT of the sheet COGs.
- [ ] `/api/layers` returns atlas layers as single entries (group by `atlas_id`)

---

## Phase 3: "What stood here" (1–2 weeks)

- [ ] Cache Wikidata responses (a `facts_cache` table keyed on rounded lat/lon + radius; TTL 30 days)
- [ ] OpenHistoricalMap: query features at the point with `start_date <= year <= end_date` (Overpass endpoint for OHM)
- [ ] Rank facts: buildings > organisations > broadcast stations (use Wikidata P31 instance-of classes; filter radio
      stations etc. out)
- [ ] **Core sample** drawer (`I`) per DESIGN.md: vertical lifespan bands, a `--survey` year line, click a band → jump the ruler

---

## Phase 4: Automatic georeferencing (research, months)

See docs/GEOREFERENCING.md §4. The milestones are:
- [ ] 4a. Text-spotting: run mapKurator (or a vision LLM on 1024 px tiles) → street-name labels + pixel boxes
- [ ] 4b. Geocode the label pairs at intersections against OSM → candidate GCPs → RANSAC affine → accept if LOO RMSE < 25 m
- [ ] 4c. Refinement: road-network extraction (segmentation) → match to OSM intersections near the 4b solution → TPS
- [ ] 4d. Eval: compare against hand-georeferenced Sanborn sheets (Phase 2) as ground truth; report the median error
- [ ] 4e. Human-in-the-loop: open low-confidence maps in Allmaps Editor pre-filled with the auto GCPs

---

## Phase 5: Beyond NYC

- [ ] Second city with different sources: London (NLS OS maps, already georeferenced) or Amsterdam
- [ ] India: Survey of India / British Library maps (check rights per item), Rumsey's South Asia holdings (NC license)
- [ ] Aerial photos: USGS EarthExplorer "Aerial Photo Single Frames" (1930s+, need georeferencing like maps)
- [ ] Public API with keys; embeddable widget

---

## Costs

| Item | Monthly |
|---|---|
| VPS for API + PostGIS + TiTiler | ~$10–25 |
| Object storage (Cloudflare R2, free egress) for USGS COGs | ~$1–5 (tens of GB) |
| Base map tiles (production provider) | free tier → ~$25 |
| Allmaps tile server | free (public). Self-host if you get traffic |

## Risks

| Risk | Mitigation |
|---|---|
| Licenses (Rumsey NC, some NLS tiles) | a `license` column + a UI badge + a filter |
| Uneven coverage outside big cities | the slider only offers years that exist; USGS gives national baseline coverage |
| Old maps drawn wrong (not just warped) | show `rmse_m`; allow TPS; never claim building-level accuracy on small-scale maps |
| Third-party tile servers go down / lack CORS | ingest-time CORS check; mirror to our own COGs when a source is flaky |
| Street renumbering (Chicago 1909, etc.) | geocode today's address → coordinates; never match on old addresses |

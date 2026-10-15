# strata

![350 5th Avenue in 1916: an NYPL map warped over today's city, with the year, the ruler and the map's error](docs/screenshots/located-1440.webp)

**A time-travel map.** Type a New York address and slide back through two centuries: strata finds every georeferenced
historical map that covers the spot, lays the best one over today's city, and tells you where it came from, under what
license, and how far off its alignment is, in metres.

```
350 5th Avenue, Manhattan
  1916  Area District Map Section No. 8 (NYPL)       ±17 m   public domain
  1947  USGS 1:24,000 Brooklyn quadrangle            ±12 m   public domain
```

The catalog is the product. The maps themselves stay where their institutions publish them: strata stores which map
covers which ground, when it was surveyed, how accurate it is and under what terms, and answers "best maps for this
point in this year" in one query.

## Features

- **One query API** over several collections: NYPL (Map Warper georeferencing, via Allmaps), USGS historical topographic
  maps, and Allmaps annotations from the Library of Congress, the David Rumsey Map Collection, the Leventhal Map Center
  and others.
- **Honest error.** Every layer carries a leave-one-out RMSE in ground metres (or the USGS map accuracy standard), shown
  as ±N m and drawn as a halo around the pin. Maps worse than 100 m, or with fewer than four control points, are not
  catalogued.
- **License on every layer**, survey year where known (publication year kept separately), and the mapped footprint
  rather than the sheet's bounding box.
- **No re-hosting.** IIIF maps are warped in the browser straight from the source institution; USGS GeoTIFFs are read
  in place through TiTiler, with the map collar cropped in the tile URL.
- **The interface:** a near-invisible dark base map so the old maps are the only colour, a year numeral, a ruler with
  notches only at years that have maps, crossfading layers with neighbouring years preloaded, swipe compare between then
  and today, shareable URLs and a PNG poster export. Keyboard-complete; `?` lists the keys.
- **What stood here** (`I`): nearby buildings and places from Wikidata and OpenHistoricalMap drawn as lifespans in a
  column of time, with the selected year marked; pick one to jump to its maps.

## Status

New York City is the pilot. The catalog holds **3,369 maps covering 123 distinct years from 1609 to 2000**: 2,902 from
NYPL, 293 USGS topographic maps, and 174 from the Library of Congress, the David Rumsey collection, the Leventhal Map
Center and others (an NYPL import is still adding sheets).

- **Coverage:** 10 random Manhattan addresses (two seeded draws of 5) each show **35 to 67 years** of maps; every map
  offered carries a license and an error figure, and the interface loads each address with no console errors.
- **Lighthouse** (mobile profile, start page): Performance 93-99, Accessibility 100, Best Practices 100, SEO 100.
- **Integrity:** maps whose source image has been replaced or rotated since it was georeferenced are dropped (182 of
  the first 3,251 NYPL and Allmaps maps).

![The 1916 map at 350 5th Avenue with the "what stood here" column: the Waldorf-Astoria lit, the Empire State Building still to come](docs/screenshots/core-1440.webp)

Next: georeferencing whole Sanborn atlas volumes in Allmaps Editor (the ingester picks them up), then automatic
georeferencing from street-name labels, and a second city.

## Run it

Requirements: Python 3.11+, Node 20+, Docker.

```bash
python -m venv .venv && . .venv/bin/activate      # Windows Git Bash: . .venv/Scripts/activate
pip install -e ".[dev]"
docker compose up -d db                           # PostGIS, schema.sql applied on first start
docker compose --profile tiles up -d titiler      # serves USGS maps
python -m strata.ingest usgs_topo                 # then: nypl_warper, allmaps (polite: ~1 request/s, cached)
(cd web && npm ci && npm run build)
uvicorn strata.api:app --port 8000                # http://localhost:8000
```

Or everything in containers:

```bash
docker compose --profile app --profile tiles up -d --build          # app on http://localhost:8000
docker compose run --rm app python -m strata.ingest usgs_topo       # then nypl_warper, allmaps
```

For UI development run `npm run dev` in `web/` (http://localhost:5180); it proxies `/api` to the API on port 8012, or to
`STRATA_API`.

Ingesters take an optional `--bbox=minlon,minlat,maxlon,maxlat` (default: New York City) and only keep maps whose
footprint touches the city.

## Configuration

See `.env.example`.

| Variable | Default | Used for |
|---|---|---|
| `DATABASE_URL` | `postgresql://strata:strata@localhost:5432/strata` | API and ingesters |
| `TITILER_URL` | `http://localhost:8001` | written into USGS tile URLs at ingest time |
| `STRATA_API` | `8012` | the API port the Vite dev server proxies to |

## Deploy

One small VPS runs the `app` image (FastAPI serving the built UI), PostGIS and TiTiler; put a CDN in front of TiTiler,
since tiles never change, and TLS in front of the app. Re-run the USGS ingester with the production `TITILER_URL`. Geocoding uses Photon's
public instance (fair use); self-host Photon or use a commercial geocoder for real traffic.

## Tests

```bash
pytest -q                                        # unit tests; database tests run when DATABASE_URL is set
cd web && npm run typecheck
```

Tests never touch the network.

## Design

Dark only, by design: the historical maps are the light in the room.

| Token | Value | Job |
|---|---|---|
| `--night` | `#07090B` | ground and base-map land |
| `--vellum` | `#EFE9DD` | primary type |
| `--slate` | `#98A0A8` | secondary type, minor ticks |
| `--hair` | vellum at 8% | every rule, panel edge and base-map road; never brighter |
| `--survey` | `#F2A93B` | "now" only: the year, the current notch, the pin |
| `--error` | `#C9A27A` | the ±N m readout and the accuracy halo |

Fraunces for the year and map titles, IBM Plex Mono for every number, Instrument Sans for controls; all self-hosted.
Text over map imagery always stands on a `--night` ground, and every token clears WCAG AA on it.

## How it works

**Catalog.** PostGIS holds one row per map (`schema.sql`): the mapped footprint after warping, survey and publication
year, scale, error, method, license, and how to draw it (a Georeference Annotation or an XYZ tile URL).
`/api/layers` ranks the maps covering a point by closeness in time, then detail (scale), then accuracy.

| Endpoint | Returns |
|---|---|
| `GET /api/timeline?lat&lon` | every year with a map covering the point |
| `GET /api/layers?lat&lon&year&limit` | the best maps for that point and year, with license, error and bounds |
| `GET /api/history?lat&lon` | dated buildings and places within 150 m, with their lifespans (cached 30 days) |
| `GET /api/whatwashere?lat&lon&year` | the same, limited to what existed that year |
| `GET /api/atlas?id` | every georeferenced sheet of one atlas volume |
| `GET /api/catalog` | map count and years, for the start screen |

**Error.** For maps with control points, strata refits the alignment without each point in turn and measures how far
that point lands from where it should (leave-one-out RMSE, in ground metres). USGS maps use the National Map Accuracy
Standard for their scale.

**Sources.**

| Collection | Reached through | License |
|---|---|---|
| NYPL Map Division (Map Warper georeferencing) | NYPL Space/Time dataset + Allmaps annotations | public domain to 1930; later items unverified |
| USGS Historical Topographic Maps | TNM Access API; COGs on USGS's S3 | public domain |
| Library of Congress | Allmaps annotations + loc.gov JSON | no known restrictions (per item) |
| David Rumsey Map Collection | Allmaps annotations + LUNA | CC BY-NC-SA 3.0 (non-commercial) |
| Leventhal Map Center and others | Allmaps annotations + IIIF manifests | per item, as published |

**Automatic georeferencing (prototype).** `python -m strata.autogeoref <map id>` reads the street intersections on a
scan with Claude, finds them in today's OpenStreetMap, fits the alignment with RANSAC (ambiguous street names and
misreadings are outvoted), and reports the result against the map's hand-placed control points. Needs
`pip install -e ".[autogeoref]"` and an Anthropic API key; a 2 x 2 tiling costs about $0.20 per map.

Ingesters keep a map only if it covers New York City, has at least four control points (or a published accuracy), an
error under 100 m, a datable year, and an image that still matches its georeferencing.

## License

Code: MIT. Map images keep their source licenses, stored per layer in `maps.license` (for example, the David Rumsey
collection is CC BY-NC-SA: non-commercial only). Base map © OpenStreetMap contributors, tiles by OpenFreeMap.

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

One small VPS runs FastAPI, PostGIS and TiTiler; put a CDN in front of TiTiler, since tiles never change. Build `web/`
first: FastAPI serves `web/dist`. Re-run the USGS ingester with the production `TITILER_URL`. Geocoding uses Photon's
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

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system, data model, ranking, tiles, frontend, API
- [docs/GEOREFERENCING.md](docs/GEOREFERENCING.md): control points, transforms, error, automatic georeferencing
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md): collections, endpoints, licenses

## License

Code: MIT. Map images keep their source licenses, stored per layer in `maps.license` (for example, the David Rumsey
collection is CC BY-NC-SA: non-commercial only). Base map © OpenStreetMap contributors, tiles by OpenFreeMap.

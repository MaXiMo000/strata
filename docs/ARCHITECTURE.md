# strata: architecture

## System

```
 ┌──────────────────── web/index.html (MapLibre GL JS) ─────────────────────┐
 │ address → Photon geocode → /api/timeline → slider → /api/layers + facts  │
 └────────┬──────────────────────────────────────┬──────────────────────────┘
          │ JSON                                 │ XYZ raster tiles (CORS required)
 ┌────────▼─────────────┐             ┌──────────┴───────────────────────────────┐
 │ FastAPI (strata.api) │             │ tile sources                             │
 │ /api/timeline        │             │ • Allmaps tile server: warps IIIF images │
 │ /api/layers          │             │   on the fly from GCP annotations        │
 │ /api/whatwashere ────┼──► Wikidata │ • TiTiler: our COGs (USGS, custom warps) │
 └────────┬─────────────┘             │ • source tiles (NYPL Warper, NLS)        │
          │ SQL                       └──────────────────────────────────────────┘
 ┌────────▼───────────────┐   ◄── ingest CLI: python -m strata.ingest <source>
 │ PostGIS: maps, gcps    │        nypl_warper · usgs_topo · allmaps · loc_sanborn
 └────────────────────────┘
```

**The catalog (PostGIS) is the product.** Tiles are mostly served by others. The value is knowing *which* map,
*where*, *when*, *how accurate*, and *under what license*, and answering that in one query.

## Data model (`schema.sql`)

| Column | Why |
|---|---|
| `footprint MultiPolygon` | The **mapped area after warping**, not the sheet's bounding box. Otherwise the ocean or margins of a sheet "cover" points they don't show. For Allmaps/Warper, use the warped mask polygon. |
| `year` / `year_published` | The survey year drives the slider. The publication year is kept for citations. |
| `scale_denom` | A tie-breaker: a larger-scale (more detailed) map wins. |
| `rmse_m` | Leave-one-out GCP error in ground meters. Shown as ±N m. Ingest skips maps above `ingest.MAX_RMSE_M` (100 m) or with < 4 GCPs. |
| `method` | poly1/2/3, tps, or pre-georeferenced. |
| `tile_url` | An XYZ template that the frontend uses directly. |
| `atlas_id` | Groups Sanborn sheets into a single per-year layer. |
| `license` | Filters out non-commercial layers when needed. |

Indexes: GiST on `footprint` (point-in-polygon), B-tree on `year`.

## Ranking (`/api/layers`)

```sql
WHERE ST_Covers(footprint, :point)
ORDER BY abs(year - :year), scale_denom NULLS LAST, rmse_m NULLS LAST
```

The order is: closest in time → most detailed → most accurate. It's deliberately lexicographic and simple. If this proves
wrong in practice (e.g. a 1911 1:600 Sanborn should beat a 1916 1:24k topo for year 1915), switch to a score:
`abs(year - Y) * 1.0 + log10(scale_denom) * 3 + rmse_m / 20`, and tune it against a handful of "right answers" you pick by hand.

`/api/timeline` = `SELECT DISTINCT year … ORDER BY year`, so the slider can only land on years that exist.

## Tiles

| Source type | How it's served | Storage |
|---|---|---|
| IIIF images + GCPs (LOC, NYPL, Rumsey via Allmaps) | **the browser** warps them with `@allmaps/maplibre` (`WarpedMapLayer`), fetching IIIF tiles straight from the institution. `tile_url` still holds the `allmaps.xyz` template for external tools | none |
| GeoTIFFs (USGS), or our own warps | `gdalwarp` → COG in `data/cogs/` or R2 → TiTiler | ours |
| Pre-tiled (NLS) | the source's XYZ URL | none |

Why not the Allmaps tile server for everything: it runs on Cloudflare, and NYPL's and LOC's IIIF servers block
Cloudflare's IP ranges, so it returns blank 200 tiles for them (checked 2026-10-02; allmaps/allmaps#638). It works for
Rumsey. In the browser the requests come from the user, and both institutions send `Access-Control-Allow-Origin: *`.
The frontend uses `georef_annotation` when present and `tile_url` otherwise.

The COG recipe is in `strata/georef.gdal_commands` (EPSG:3857, WEBP compression, alpha band).
In production, put a CDN (Cloudflare) in front of TiTiler and cache tiles aggressively, since they never change.

## Frontend

Today it's a single scaffold page (`web/index.html`). Phase 1e rebuilds it as **Vite + TypeScript** (not React: MapLibre does the heavy
lifting) to the spec in `docs/DESIGN.md`: a custom dark vector base style, the ruler slider, crossfading layers, swipe compare,
and the core-sample drawer.

## "What stood here"

- **Wikidata** (live now): items within 150 m with inception (P571) ≤ year ≤ dissolved (P576). Items with no
  inception date are excluded because they can't be placed in time. It's noisy (radio stations, organisations), so Phase 3
  filters by P31 class.
- **OpenHistoricalMap** (Phase 3): vector features with `start_date`/`end_date`.
- **Sanborn** (Phase 2): the map itself *is* the answer at building level. Phase 5+ could extract footprints.

## API

| Method | Path | Result |
|---|---|---|
| GET | `/api/timeline?lat&lon` | `[1857, 1891, 1916, 1955, …]` |
| GET | `/api/layers?lat&lon&year&limit=5` | `[{id,title,source,source_url,license,year,scale_denom,rmse_m,method,tile_url,georef_annotation}]` |
| GET | `/api/whatwashere?lat&lon&year` | `[{wikidata,name,start,end,distance_m}]` |

Inputs are validated (lat/lon ranges, year 1000–2100, limit ≤ 20). All SQL is parameterised.

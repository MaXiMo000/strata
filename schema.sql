-- Loaded automatically by docker compose on first start.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE maps (
  id                 text PRIMARY KEY,               -- "<source>:<native id>", e.g. "loc:sanborn05662_004_12"
  title              text NOT NULL,
  source             text NOT NULL,                  -- usgs | loc | nypl | rumsey | nls | allmaps
  source_url         text,                           -- human page for attribution
  license            text NOT NULL,                  -- "public-domain" | "CC-BY-NC-SA-3.0" | ...  (filter on this before monetising)
  year               int  NOT NULL,                  -- SURVEY year when known, else publication year
  year_published     int,
  footprint          geometry(MultiPolygon, 4326) NOT NULL,  -- the map's *mapped* area after warping, not the sheet bbox
  scale_denom        int,                            -- 1:600 Sanborn -> 600; 1:24000 USGS -> 24000
  rmse_m             real,                           -- leave-one-out GCP error in ground meters (strata.georef.loo_rmse_m)
  method             text,                           -- poly1 | poly2 | poly3 | tps | pre-georeferenced
  tile_url           text NOT NULL,                  -- XYZ template: Allmaps tile server, TiTiler, or source tiles
  iiif_manifest      text,
  georef_annotation  text,                           -- Allmaps / W3C Georeference Annotation URL
  atlas_id           text,                           -- groups Sanborn sheets into one per-year mosaic layer
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maps_footprint_gist ON maps USING gist (footprint);
CREATE INDEX maps_year ON maps (year);

CREATE TABLE gcps (
  map_id  text NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  px      real NOT NULL,
  py      real NOT NULL,
  lon     double precision NOT NULL,
  lat     double precision NOT NULL,
  origin  text NOT NULL DEFAULT 'imported'           -- imported | manual | auto-text | auto-roads
);
CREATE INDEX ON gcps (map_id);

"""Ingest framework: idempotent upserts into the catalog + a polite, cached HTTP getter for sources.

Each source is a module `strata.ingest.<source>` with `run(conn, bbox)`; run it with `python -m strata.ingest <source>`.
"""
import hashlib
import json
import os
import time
from pathlib import Path

import httpx
import psycopg

DB = os.environ.get("DATABASE_URL", "postgresql://strata:strata@localhost:5432/strata")
CACHE = Path(__file__).resolve().parents[2] / "data" / "cache"
UA = "strata/0.0 (+https://github.com/MaXiMo000/strata; historical map catalog)"
NYC_BBOX = (-74.26, 40.49, -73.70, 40.92)  # minlon, minlat, maxlon, maxlat
# A layer whose leave-one-out error exceeds this can't say anything about one address (continent maps that happen to
# cover NYC score 10 km+). Hand-drawn city plans reach 50-200 m; atlases 10-30 m. Maps with < 4 GCPs have no error at all.
MAX_RMSE_M = 100.0

REQUIRED = ("id", "title", "source", "license", "year", "footprint", "tile_url")
COLUMNS = ("id", "title", "source", "source_url", "license", "year", "year_published", "scale_denom", "rmse_m",
           "method", "tile_url", "iiif_manifest", "georef_annotation", "atlas_id")

_last_request = 0.0


def get(url: str, params: dict | None = None, *, cache: bool = True, min_interval: float = 1.0, client=None) -> bytes:
    """GET with a descriptive User-Agent, ~1 req/s, and an on-disk cache keyed by URL + params."""
    global _last_request
    key = hashlib.sha256(json.dumps([url, params], sort_keys=True).encode()).hexdigest()
    path = CACHE / key[:2] / key
    if cache and path.exists():
        return path.read_bytes()
    for attempt in range(3):  # long runs meet the odd dropped connection or 5xx; back off 2 s, then 4 s
        time.sleep(max(0.0, _last_request + min_interval - time.monotonic()))
        try:
            r = (client or httpx).get(url, params=params, headers={"User-Agent": UA}, timeout=60, follow_redirects=True)
            _last_request = time.monotonic()
            if r.status_code < 500:
                break
        except httpx.TransportError:
            _last_request = time.monotonic()
            if attempt == 2:
                raise
        time.sleep(2 ** (attempt + 1))
    r.raise_for_status()
    if cache:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    return r.content


def get_json(url: str, params: dict | None = None, **kw):
    return json.loads(get(url, params, **kw))


def usable(rmse_m: float | None) -> bool:
    return rmse_m is not None and rmse_m <= MAX_RMSE_M


def connect():
    return psycopg.connect(DB)


def check_map(m: dict) -> None:
    """Refuse rows that would break the catalog's promises (license, year, footprint, tiles)."""
    missing = [k for k in REQUIRED if m.get(k) in (None, "")]
    if missing:
        raise ValueError(f"{m.get('id')}: missing {', '.join(missing)}")
    if m["footprint"].get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError(f"{m['id']}: footprint must be a GeoJSON Polygon/MultiPolygon")


def upsert_map(conn, m: dict) -> None:
    """Insert or update one map by `id`. `footprint` is a GeoJSON (Multi)Polygon dict in EPSG:4326."""
    check_map(m)
    row = {c: m.get(c) for c in COLUMNS} | {"footprint": json.dumps(m["footprint"])}
    cols = ", ".join((*COLUMNS, "footprint"))
    vals = ", ".join([f"%({c})s" for c in COLUMNS] + ["ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(footprint)s), 4326))"])
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in (*COLUMNS[1:], "footprint"))
    conn.execute(f"INSERT INTO maps ({cols}) VALUES ({vals}) ON CONFLICT (id) DO UPDATE SET {updates}", row)


def upsert_gcps(conn, map_id: str, rows, origin: str = "imported") -> None:
    """Replace this map's GCPs of one origin. rows: [(px, py, lon, lat), ...]."""
    conn.execute("DELETE FROM gcps WHERE map_id = %s AND origin = %s", (map_id, origin))
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO gcps (map_id, px, py, lon, lat, origin) VALUES (%s, %s, %s, %s, %s, %s)",
                        [(map_id, *r, origin) for r in rows])

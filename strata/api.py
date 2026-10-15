"""Query API: which historical maps cover a point, for which years, and what stood there."""
import os
from pathlib import Path

import psycopg
from fastapi import FastAPI, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row

from psycopg.types.json import Jsonb

from .whatwashere import existed_in, history

DB = os.environ.get("DATABASE_URL", "postgresql://strata:strata@localhost:5432/strata")
WEB = Path(__file__).resolve().parent.parent / "web" / "dist"  # npm run build (in web/)
app = FastAPI(title="strata")
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def cache_assets(request: Request, call_next):
    """Built assets have content hashes in their names, so they never change: cache them for a year."""
    response = await call_next(request)
    if request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response

POINT = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)"


def q(sql: str, **params) -> list[dict]:
    # One connection per request; move to psycopg_pool.ConnectionPool under real traffic.
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        return conn.execute(sql, params).fetchall()


Lat = Query(ge=-90, le=90)
Lon = Query(ge=-180, le=180)


@app.get("/api/timeline")
def timeline(lat: float = Lat, lon: float = Lon):
    """Distinct years with a map covering this point. Drives the slider's snap points."""
    rows = q(f"SELECT DISTINCT year FROM maps WHERE ST_Covers(footprint, {POINT}) ORDER BY year", lat=lat, lon=lon)
    return [r["year"] for r in rows]


@app.get("/api/layers")
def layers(lat: float = Lat, lon: float = Lon, year: int = Query(ge=1000, le=2100), limit: int = Query(5, le=20)):
    """Best maps for (point, year): closest in time, then most detailed, then most accurate. An atlas volume counts
    once (its best sheet here); the client draws the rest of the volume around it."""
    rank = "abs(year - %(year)s), scale_denom NULLS LAST, rmse_m NULLS LAST"
    return q(
        f"""SELECT id, title, source, source_url, license, year, scale_denom, rmse_m, method, tile_url, georef_annotation,
                   atlas_id, bounds
            FROM (SELECT *, ARRAY[ST_XMin(footprint), ST_YMin(footprint), ST_XMax(footprint), ST_YMax(footprint)] AS bounds,
                         row_number() OVER (PARTITION BY coalesce(atlas_id, id) ORDER BY {rank}) AS nth
                  FROM maps WHERE ST_Covers(footprint, {POINT})) m
            WHERE nth = 1
            ORDER BY {rank}
            LIMIT %(limit)s""",
        lat=lat, lon=lon, year=year, limit=limit,
    )


@app.get("/api/atlas")
def atlas(id: str = Query(min_length=3, max_length=200)):
    """Every georeferenced sheet of one atlas volume, so the client can draw them as one mosaic."""
    return [r["georef_annotation"] for r in q(
        "SELECT georef_annotation FROM maps WHERE atlas_id = %(id)s AND georef_annotation IS NOT NULL ORDER BY id", id=id)]


@app.get("/api/catalog")
def catalog():
    """What the catalog holds, for the arrival screen: map count and every year with a map anywhere."""
    rows = q("SELECT year, count(*) AS n FROM maps GROUP BY year ORDER BY year")
    return {"maps": sum(r["n"] for r in rows), "years": [r["year"] for r in rows]}


def cached_history(lat: float, lon: float) -> list[dict]:
    """history() through facts_cache: keyed on lat/lon rounded to ~10 m, refreshed after 30 days."""
    key = f"history:{lat:.4f}:{lon:.4f}"
    rows = q("SELECT body FROM facts_cache WHERE key = %(k)s AND fetched > now() - interval '30 days'", k=key)
    if rows:
        return rows[0]["body"]
    places = history(round(lat, 4), round(lon, 4))
    with psycopg.connect(DB) as conn:
        conn.execute("INSERT INTO facts_cache (key, body) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE "
                     "SET body = EXCLUDED.body, fetched = now()", (key, Jsonb(places)))
    return places


@app.get("/api/history")
def place_history(lat: float = Lat, lon: float = Lon):
    """Dated buildings and places near the point with their lifespans (the core sample)."""
    return cached_history(lat, lon)


@app.get("/api/whatwashere")
def whatwashere(lat: float = Lat, lon: float = Lon, year: int = Query(ge=1000, le=2100)):
    return [p for p in cached_history(lat, lon) if existed_in(p["start"], p["end"], year)]


if WEB.is_dir():  # after the API routes, so /api/* wins
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")

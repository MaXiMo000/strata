"""Query API: which historical maps cover a point, for which years, and what stood there."""
import os
from pathlib import Path

import psycopg
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row

from .whatwashere import what_was_here

DB = os.environ.get("DATABASE_URL", "postgresql://strata:strata@localhost:5432/strata")
WEB = Path(__file__).resolve().parent.parent / "web" / "dist"  # npm run build (in web/)
app = FastAPI(title="strata")

POINT = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)"


def q(sql: str, **params) -> list[dict]:
    # ponytail: connection per request; switch to psycopg_pool.ConnectionPool when traffic is real
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
    """Best maps for (point, year): closest in time, then most detailed, then most accurate."""
    return q(
        f"""SELECT id, title, source, source_url, license, year, scale_denom, rmse_m, method, tile_url, georef_annotation
            FROM maps
            WHERE ST_Covers(footprint, {POINT})
            ORDER BY abs(year - %(year)s), scale_denom NULLS LAST, rmse_m NULLS LAST
            LIMIT %(limit)s""",
        lat=lat, lon=lon, year=year, limit=limit,
    )


@app.get("/api/catalog")
def catalog():
    """What the catalog holds, for the arrival screen: map count and every year with a map anywhere."""
    rows = q("SELECT year, count(*) AS n FROM maps GROUP BY year ORDER BY year")
    return {"maps": sum(r["n"] for r in rows), "years": [r["year"] for r in rows]}


@app.get("/api/whatwashere")
def whatwashere(lat: float = Lat, lon: float = Lon, year: int = Query(ge=1000, le=2100)):
    return what_was_here(lat, lon, year)


if WEB.is_dir():  # after the API routes, so /api/* wins
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")

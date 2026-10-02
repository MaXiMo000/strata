"""NYPL Map Warper maps, served today through Allmaps.

NYPL archived Map Warper in April 2021 (maps.nypl.org/warper now redirects to Archive-It), so its tiles are gone.
The georeferencing survived in two places, and we join them on the NYPL image id:
  - NYPL's Space/Time dataset (2017 export of Map Warper): title, year, NYPL item URL. No live tiles.
  - Allmaps, which imported the Warper GCPs as Georeference Annotations: live GCPs, warped footprint, XYZ tiles.
"""
import hashlib
import html
import json

from . import MAX_RMSE_M, get, get_json, upsert_gcps, upsert_map, usable
from ..georef import loo_rmse_m

DATASET = "http://s3.amazonaws.com/spacetime-nypl-org/datasets/mapwarper/mapwarper.objects.ndjson"
IIIF = "https://iiif.nypl.org/iiif/2/{}"
ALLMAPS_IMAGE_MAPS = "https://api.allmaps.org/images/{}/maps.geojson"
TILES = "https://allmaps.xyz/maps/{}/{{z}}/{{x}}/{{y}}.png"  # CORS: Access-Control-Allow-Origin: * (checked 2026-10-02)


def allmaps_id(url: str) -> str:
    """Allmaps ids are the first 16 hex chars of the SHA-1 of the resource URL."""
    return hashlib.sha1(url.encode()).hexdigest()[:16]


def license_for(year: int) -> str:
    # ponytail: rights by year rule; per-item NYPL rights need an API token (api.repo.nypl.org). Add it before monetising.
    return "public-domain" if year <= 1930 else "nypl-rights-unverified"


def method_for(transformation: dict | None) -> str:
    t = transformation or {"type": "polynomial"}
    if t["type"] == "thinPlateSpline":
        return "tps"
    return f"poly{(t.get('options') or {}).get('order', 1)}"


def in_bbox(geometry: dict, bbox) -> bool:
    """Does the geometry's bounding box overlap bbox (minlon, minlat, maxlon, maxlat)?"""
    rings = geometry["coordinates"] if geometry["type"] == "Polygon" else [r for p in geometry["coordinates"] for r in p]
    xs = [c[0] for r in rings for c in r]
    ys = [c[1] for r in rings for c in r]
    return min(xs) <= bbox[2] and max(xs) >= bbox[0] and min(ys) <= bbox[3] and max(ys) >= bbox[1]


def plausible(record: dict) -> bool:
    """Cheap pre-filter on the 2017 GCPs (stored [px, py, lat, lon]) so we don't fetch continent maps from Allmaps.
    2x slack: Allmaps' GCPs may have been improved since."""
    g = [(px, py, lon, lat) for px, py, lat, lon in record["data"].get("gcps") or []]
    return len(g) >= 4 and loo_rmse_m(g) <= 2 * MAX_RMSE_M


def records(bbox) -> list[dict]:
    """Dated single maps from the Space/Time dataset that overlap bbox (layers have no imageId and are skipped)."""
    rows = (json.loads(line) for line in get(DATASET).splitlines() if line.strip())
    return [r for r in rows if r["data"].get("imageId") and r.get("validSince") and r.get("geometry")
            and in_bbox(r["geometry"], bbox) and plausible(r)]


def to_row(record: dict, feature: dict) -> tuple[dict, list[tuple]]:
    """One Space/Time record + one Allmaps map feature -> (maps row, GCPs)."""
    p = feature["properties"]
    map_id = p["id"].rsplit("/", 1)[-1]
    gcps = [(g["resource"][0], g["resource"][1], g["geo"][0], g["geo"][1]) for g in p["gcps"]]
    year = int(record["validSince"])
    return {
        "id": f"nypl:{map_id}",
        "title": html.unescape(record["name"]),
        "source": "nypl",
        "source_url": record["data"]["nyplUrl"].replace("http://", "https://"),
        "license": license_for(year),
        "year": year,
        "footprint": feature["geometry"],  # Allmaps' warped resource mask, not the sheet bbox
        "rmse_m": loo_rmse_m(gcps) if len(gcps) >= 4 else None,
        "method": method_for(p.get("transformation")),
        "tile_url": TILES.format(map_id),
        "iiif_manifest": p["resource"]["id"],  # the IIIF image service; NYPL manifests need an API token
        "georef_annotation": p["id"],
    }, gcps


def run(conn, bbox) -> int:
    n = 0
    recs = records(bbox)
    print(f"nypl: {len(recs)} dated maps in bbox; fetching Allmaps annotations (~1 req/s, cached)")
    for i, rec in enumerate(recs, 1):
        try:
            fc = get_json(ALLMAPS_IMAGE_MAPS.format(allmaps_id(IIIF.format(rec["data"]["imageId"]))))
        except Exception as e:  # one missing image shouldn't stop a 2-hour run
            print(f"  skip {rec['data']['imageId']}: {e}")
            continue
        for f in fc.get("features", []):
            if not f.get("geometry"):
                continue
            row, gcps = to_row(rec, f)
            if not usable(row["rmse_m"]):
                continue
            if upsert_map(conn, row):
                upsert_gcps(conn, row["id"], gcps)
                n += 1
        if i % 50 == 0:
            conn.commit()  # the app sees maps arrive during a long run
            print(f"  {i}/{len(recs)} records, {n} maps")
    return n

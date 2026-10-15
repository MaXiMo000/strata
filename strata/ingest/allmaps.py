"""Allmaps Georeference Annotations from institutions other than NYPL (LOC, David Rumsey, Leventhal/BPL, Princeton, ...).

Annotations carry GCPs, the warped mask and the transformation, but no date or rights, so each map's year and license
come from its institution: LOC's JSON API, Rumsey's LUNA API, or else the IIIF manifest. Maps we can't date are skipped.
NYPL maps come from nypl_warper (it has their dates) and are left out here.
"""
import json
import re

import httpx

from . import get_json, image_matches, upsert_gcps, upsert_map, usable
from .nypl_warper import method_for
from ..georef import loo_rmse_m

API = "https://api.allmaps.org/maps.geojson"
TILES = "https://allmaps.xyz/maps/{}/{{z}}/{{x}}/{{y}}.png"
# A city plan covers ~100-1,000 km2; anything bigger can't say much about one address (and saturates the 200 cap).
MAX_AREA_M2 = 5e9
SKIP_DOMAINS = {"iiif.nypl.org"}
YEAR = re.compile(r"\b(1[5-9]\d\d|20[0-2]\d)\b")


def host(feature: dict) -> str:
    return httpx.URL(feature["properties"]["resource"]["id"]).host


def search(bbox, domain: str | None = None, depth: int = 0) -> dict[str, dict]:
    """All maps intersecting bbox. The API returns at most 200 with no paging, so split full cells into quadrants."""
    params = {"intersects": f"{bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]}", "maxArea": MAX_AREA_M2, "limit": 200}
    if domain:
        params["imageServiceDomain"] = domain
    fs = get_json(API, params)["features"]
    out = {f["properties"]["id"]: f for f in fs}
    if len(fs) >= 200 and depth < 6:
        mx, my = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
        for q in ((bbox[0], bbox[1], mx, my), (mx, bbox[1], bbox[2], my), (bbox[0], my, mx, bbox[3]), (mx, my, bbox[2], bbox[3])):
            out |= search(q, domain, depth + 1)
    return out


def domains(bbox, n: int = 4) -> set[str]:
    """Institutions with maps here, from an n x n grid of unfiltered queries (NYPL fills those, hence per-domain search)."""
    found = set()
    for i in range(n):
        for j in range(n):
            x = bbox[0] + (i + 0.5) * (bbox[2] - bbox[0]) / n
            y = bbox[1] + (j + 0.5) * (bbox[3] - bbox[1]) / n
            fs = get_json(API, {"intersects": f"{y},{x}", "maxArea": MAX_AREA_M2, "limit": 200})["features"]
            found |= {host(f) for f in fs}
    return found - SKIP_DOMAINS


def manifest_url(feature: dict) -> str | None:
    for canvas in feature["properties"]["resource"].get("partOf") or []:
        for m in canvas.get("partOf") or []:
            if m.get("type") == "Manifest":
                return m["id"]
    return None


def _text(v) -> str:
    """IIIF v2/v3 label/value -> plain text."""
    if isinstance(v, dict):
        return _text(v["@value"]) if "@value" in v else " ".join(_text(x) for x in v.values())
    if isinstance(v, list):
        return " ".join(_text(x) for x in v)
    return str(v or "")


def year_in(s: str) -> int | None:
    m = YEAR.search(s or "")
    return int(m.group(1)) if m else None


def earliest(year: int | None, title: str) -> int | None:
    """A manifest's date can be when it was scanned ("...Directory 1853", dated 2023). A map can't be scanned before it
    was drawn, so a year named in the title wins over a later metadata date."""
    t = year_in(title)
    return t if t and year and t < year else year


def from_manifest(m: dict) -> tuple[int | None, str]:
    """(year, license) from a IIIF manifest: navDate, else a metadata entry labelled like a date; rights/license URL."""
    year = year_in(m.get("navDate") or "")
    for e in m.get("metadata") or []:
        if year is None and re.search(r"date|created|published|year", _text(e.get("label")), re.I):
            year = year_in(_text(e.get("value")))
    rights = _text(m.get("rights") or m.get("license"))
    return year, rights or "see-source"


def loc_parts(resource_id: str) -> tuple[str, int | None]:
    """LOC image ids name their item and page: ...:g3804bm:g3804bm_g05791188809:05791_09_1888-0012 is item
    g3804bm.g3804bm_g05791188809 (one atlas volume), sheet 12. Manifests are often hosted elsewhere, so read the id."""
    parts = resource_id.rsplit("/", 1)[-1].split(":")
    page = re.search(r"(\d+)$", parts[-1])
    return f"{parts[-3]}.{parts[-2]}", int(page.group(1)) if page else None


def from_loc(resource_id: str) -> tuple[int | None, str, str, str, str]:
    """(year, license, page URL, title, atlas id) from LOC's JSON API (its manifest URLs sit behind a bot check)."""
    resource, sheet = loc_parts(resource_id)
    it = get_json(f"https://www.loc.gov/resource/{resource}/", {"fo": "json"})["item"]
    advisory = _text(it.get("rights_advisory"))
    title = _text(it.get("title")).strip().rstrip(".")
    url = f"https://www.loc.gov/resource/{resource}/" + (f"?sp={sheet}" if sheet else "")
    return (year_in(_text(it.get("date"))), advisory or "no-known-restrictions", url,
            f"{title}, sheet {sheet}" if sheet else title, f"loc:{resource}")


def from_rumsey(resource_id: str) -> tuple[int | None, int | None, str]:
    """(map date, publication date, title) from LUNA; the IIIF manifest has no metadata."""
    mid = resource_id.rsplit("/", 1)[-1]
    d = get_json("https://www.davidrumsey.com/luna/servlet/as/fetchMediaSearch", {"mid": mid, "fullData": "true"})[0]
    fields = {json.loads(e["field"])["fieldName"]: e.get("value") for e in json.loads(d["fieldValues"])}
    return year_in(fields.get("date")), year_in(fields.get("pub_date")), (d.get("displayName") or "").strip()


def to_row(feature: dict, year: int, license: str, source_url: str | None, title: str, year_published=None, atlas_id=None):
    p = feature["properties"]
    map_id = p["id"].rsplit("/", 1)[-1]
    gcps = [(g["resource"][0], g["resource"][1], g["geo"][0], g["geo"][1]) for g in p["gcps"]]
    return {
        "id": f"allmaps:{map_id}",
        "title": title,
        "source": host(feature).removeprefix("www.").removeprefix("iiif."),
        "source_url": source_url,
        "license": license,
        "year": year,
        "year_published": year_published,
        "footprint": feature["geometry"],
        "rmse_m": loo_rmse_m(gcps) if len(gcps) >= 4 else None,
        "method": method_for(p.get("transformation")),
        "tile_url": TILES.format(map_id),
        "iiif_manifest": manifest_url(feature),
        "georef_annotation": p["id"],
        "atlas_id": atlas_id,
    }, gcps


def describe(feature: dict) -> tuple | None:
    """(year, license, source_url, title, year_published, atlas_id) for one map, or None if it can't be dated."""
    p, manifest = feature["properties"], manifest_url(feature)
    label = _text((p["resource"].get("partOf") or [{}])[0].get("partOf", [{}])[0].get("label")) if manifest else ""
    h = host(feature)
    if h == "tile.loc.gov":
        year, lic, url, title, atlas = from_loc(p["resource"]["id"])
        return (year, lic, url, title or label, None, atlas) if year else None
    if h == "www.davidrumsey.com":
        year, pub, name = from_rumsey(p["resource"]["id"])
        title = label or name or "Untitled map (David Rumsey Map Collection)"
        url = "https://www.davidrumsey.com/luna/servlet/detail/" + p["resource"]["id"].rsplit("/", 1)[-1]
        return (year or pub, "CC-BY-NC-SA-3.0", url, title, pub, None) if (year or pub) else None
    if not manifest:
        return None
    m = get_json(manifest)
    year, lic = from_manifest(m)
    title = label or _text(m.get("label"))
    return (earliest(year, title), lic, manifest, title, None, None) if year else None


def run(conn, bbox) -> int:
    doms = domains(bbox)
    print(f"allmaps: institutions here: {sorted(doms)}")
    feats = {}
    for d in sorted(doms):
        feats |= search(bbox, d)
    print(f"allmaps: {len(feats)} maps; dating them (~1 req/s, cached)")
    n = skipped = 0
    for f in feats.values():
        try:
            info = describe(f)
        except Exception as e:  # one institution's hiccup shouldn't stop the run
            print(f"  skip {f['properties']['id']}: {e}")
            info = None
        if not info or not f.get("geometry"):
            skipped += 1
            continue
        year, lic, url, title, pub, atlas = info
        row, gcps = to_row(f, year, lic, url, title or "Untitled map", pub, atlas)
        if not usable(row["rmse_m"]) or not image_matches(f["properties"]["resource"]):
            skipped += 1
            continue
        if upsert_map(conn, row):
            upsert_gcps(conn, row["id"], gcps)
            n += 1
    print(f"allmaps: {skipped} skipped (undated, no geometry, > MAX_RMSE_M, or the image has changed)")
    return n

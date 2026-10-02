"""USGS Historical Topographic Map Collection: already georeferenced, public domain.

The GeoTIFFs on prd-tnm.s3.amazonaws.com are valid COGs (JPEG, tiled, overviews), so TiTiler reads them in place: nothing
is downloaded or re-hosted. The map collar is cropped to the quad's neatline with a GDAL `vrt://` connection string in
the tile URL itself (`projwin` in NAD27, the maps' datum).
"""
import os
import re
from urllib.parse import quote

from . import get, get_json, upsert_map, usable

PRODUCTS = "https://tnmaccess.nationalmap.gov/api/v1/products"
TITILER = os.environ.get("TITILER_URL", "http://localhost:8001")  # baked into tile_url at ingest; re-run to move hosts
# Survey year first: the slider places a map at when it was true on the ground, not when it was printed.
SURVEY_KEYS = ("Survey Year", "Field Check Year", "Aerial Photo Year", "Date on Map")
PUBLISHED_KEYS = ("Imprint Year", "Date on Map")


def years(metadata_xml: str) -> tuple[int | None, int | None]:
    """(survey year, publication year) from the FGDC metadata's <procdesc>Label</procdesc><procdate>YYYY</procdate> pairs."""
    found = dict(re.findall(r"<procdesc>([^<]+)</procdesc>\s*<procdate>(\d{4})", metadata_xml))
    pick = lambda keys: next((int(found[k]) for k in keys if k in found), None)  # noqa: E731
    return pick(SURVEY_KEYS), pick(PUBLISHED_KEYS)


def nmas_m(scale_denom: int) -> float:
    """National Map Accuracy Standard: 90% of well-defined points within 1/50 inch at map scale (1:24k -> 12.2 m).
    A CE90 standard, not a measured LOO RMSE; the best we have for pre-georeferenced sheets."""
    return scale_denom * 0.0254 / 50


def tile_url(tif: str, b: dict) -> str:
    """TiTiler XYZ template for the GeoTIFF cropped to the neatline (b = TNM boundingBox, NAD27 degrees)."""
    src = f"vrt:///vsicurl/{tif}?projwin={b['minX']},{b['maxY']},{b['maxX']},{b['minY']}&projwin_srs=EPSG:4267"
    # ponytail: projwin crops to the neatline's envelope in the map's own projection. On Transverse Mercator sheets the
    # rotated neatline leaves a thin collar wedge at the edges; a pixel cutline VRT would remove it.
    return f"{TITILER}/cog/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png?url={quote(src, safe='')}"


def to_row(item: dict, metadata_xml: str) -> dict | None:
    tif = (item.get("urls") or {}).get("GeoTIFF")
    scale = re.search(r"1:(\d+)-scale", item["title"])
    if not tif or not scale:
        return None
    scale_denom = int(scale.group(1))
    survey, published = years(metadata_xml)
    published = published or int(item["publicationDate"][:4])
    b = item["boundingBox"]
    # ponytail: footprint is the neatline in NAD27 degrees stored as WGS84 (~10-30 m shift in NYC); fine for coverage tests
    ring = [[b["minX"], b["minY"]], [b["maxX"], b["minY"]], [b["maxX"], b["maxY"]], [b["minX"], b["maxY"]], [b["minX"], b["minY"]]]
    return {
        "id": f"usgs:{item['sourceId']}",
        "title": item["title"].removeprefix("USGS "),
        "source": "usgs",
        "source_url": item["metaUrl"],
        "license": "public-domain",  # US Government work
        "year": survey or published,
        "year_published": published,
        "footprint": {"type": "Polygon", "coordinates": [ring]},
        "scale_denom": scale_denom,
        "rmse_m": nmas_m(scale_denom),
        "method": "pre-georeferenced",
        "tile_url": tile_url(tif, b),
    }


def run(conn, bbox) -> int:
    items, offset = [], 0
    while True:
        page = get_json(PRODUCTS, {"datasets": "Historical Topographic Maps", "bbox": ",".join(map(str, bbox)),
                                   "max": 500, "offset": offset, "outputFormat": "JSON"})
        items += page["items"]
        offset += 500
        if offset >= page["total"]:
            break
    print(f"usgs: {len(items)} products in bbox; fetching metadata (~1 req/s, cached)")
    n = 0
    for item in items:
        try:
            xml = get(item["vendorMetaUrl"]).decode() if item.get("vendorMetaUrl") else ""
        except Exception as e:  # no metadata -> year falls back to TNM's publicationDate
            print(f"  metadata failed for {item['sourceId']}: {e}")
            xml = ""
        row = to_row(item, xml)
        if row and usable(row["rmse_m"]):  # drops 1:250,000 sheets (±127 m)
            n += upsert_map(conn, row)
    return n

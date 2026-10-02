import argparse
import os

import httpx
import pytest

from strata import ingest
from strata.ingest.__main__ import parse_bbox

SQUARE = {"type": "Polygon", "coordinates": [[[-74.0, 40.7], [-73.9, 40.7], [-73.9, 40.8], [-74.0, 40.8], [-74.0, 40.7]]]}
MAP = {"id": "test:1", "title": "Test sheet", "source": "test", "license": "public-domain", "year": 1916,
       "footprint": SQUARE, "tile_url": "https://example.org/{z}/{x}/{y}.png"}


def test_check_map_refuses_missing_license():
    ingest.check_map(MAP)
    with pytest.raises(ValueError, match="license"):
        ingest.check_map(MAP | {"license": ""})


def test_parse_bbox():
    assert parse_bbox("-74,40.5,-73.7,40.9") == (-74, 40.5, -73.7, 40.9)
    with pytest.raises(argparse.ArgumentTypeError):
        parse_bbox("-73,40,-74,41")


def test_get_caches_and_sends_user_agent(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "CACHE", tmp_path)
    seen = []
    client = httpx.Client(transport=httpx.MockTransport(
        lambda req: seen.append(req.headers["user-agent"]) or httpx.Response(200, json={"ok": 1})))
    assert ingest.get_json("https://x.test/a", {"p": 1}, client=client, min_interval=0) == {"ok": 1}
    assert ingest.get_json("https://x.test/a", {"p": 1}, client=client, min_interval=0) == {"ok": 1}
    assert len(seen) == 1 and seen[0].startswith("strata/")


def test_get_retries_server_errors(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "CACHE", tmp_path)
    monkeypatch.setattr(ingest.time, "sleep", lambda s: None)
    codes = iter([503, 200])
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(next(codes), json={"ok": 2})))
    assert ingest.get_json("https://x.test/b", client=client, min_interval=0) == {"ok": 2}


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs a PostGIS test DB (DATABASE_URL)")
def test_upsert_map_twice_leaves_one_row():
    with ingest.connect() as conn:
        for title in ("first", "second"):
            ingest.upsert_map(conn, MAP | {"title": title})
            ingest.upsert_gcps(conn, MAP["id"], [(0, 0, -74.0, 40.7), (1, 1, -73.9, 40.8)])
        assert conn.execute("SELECT count(*), max(title) FROM maps WHERE id = %s", (MAP["id"],)).fetchone() == (1, "second")
        assert conn.execute("SELECT count(*) FROM gcps WHERE map_id = %s", (MAP["id"],)).fetchone() == (2,)
        newark = {"type": "Polygon", "coordinates": [[[-74.2, 40.72], [-74.15, 40.72], [-74.15, 40.76], [-74.2, 40.76], [-74.2, 40.72]]]}
        assert not ingest.upsert_map(conn, MAP | {"id": "test:newark", "footprint": newark})  # outside the pilot area
        conn.rollback()  # leave the catalog untouched


def test_nypl_record_plus_allmaps_feature_to_row():
    from strata.ingest import nypl_warper as nw
    from tests.test_core import synthetic_gcps

    gcps = synthetic_gcps()
    rec = {"name": "Sheet 19 &amp; 20", "validSince": 1867, "data": {"nyplUrl": "http://digitalcollections.nypl.org/items/x"}}
    feat = {"geometry": SQUARE, "properties": {
        "id": "https://annotations.allmaps.org/maps/85e54acdc421afe4",
        "resource": {"id": "https://iiif.nypl.org/iiif/2/1520742"},
        "transformation": {"type": "polynomial", "options": {"order": 1}},
        "gcps": [{"resource": [px, py], "geo": [lon, lat]} for px, py, lon, lat in gcps]}}
    row, out = nw.to_row(rec, feat)
    ingest.check_map(row)
    assert row["title"] == "Sheet 19 & 20" and row["id"] == "nypl:85e54acdc421afe4" and row["license"] == "public-domain" and row["method"] == "poly1"
    assert row["tile_url"] == "https://allmaps.xyz/maps/85e54acdc421afe4/{z}/{x}/{y}.png"
    assert row["source_url"].startswith("https://") and row["rmse_m"] < 1e-3 and len(out) == 6
    assert nw.allmaps_id("https://iiif.nypl.org/iiif/2/1993036") == "23b0ccb43c38910e"  # known Allmaps image id
    assert nw.license_for(1955) != "public-domain" and nw.method_for({"type": "thinPlateSpline"}) == "tps"
    assert ingest.usable(row["rmse_m"]) and not ingest.usable(None) and not ingest.usable(5000.0)
    assert nw.plausible({"data": {"gcps": [[px, py, lat, lon] for px, py, lon, lat in gcps]}})
    assert not nw.plausible({"data": {"gcps": [[px, py, lat, lon] for px, py, lon, lat in gcps[:3]]}})
    assert nw.in_bbox(SQUARE, (-74.05, 40.75, -73.95, 40.85)) and not nw.in_bbox(SQUARE, (-73.0, 40.0, -72.0, 41.0))


def test_usgs_item_to_row_prefers_survey_year_and_crops_to_neatline():
    from strata.ingest import usgs_topo as ut

    xml = ("<procdesc>Date on Map</procdesc>\n<procdate>1966</procdate><procdesc>Imprint Year</procdesc><procdate>1972</procdate>"
           "<procdesc>Aerial Photo Year</procdesc><procdate>1965</procdate><procdesc>Field Check Year</procdesc><procdate>1966</procdate>")
    item = {"title": "USGS 1:24000-scale Quadrangle for Central Park, NY 1966", "sourceId": "abc", "metaUrl": "https://x",
            "publicationDate": "1966-01-01", "boundingBox": {"minX": -74.0, "maxX": -73.875, "minY": 40.75, "maxY": 40.875},
            "urls": {"GeoTIFF": "https://prd-tnm.s3.amazonaws.com/a/NY_Central%20Park_1966.tif"}}
    row = ut.to_row(item, xml)
    ingest.check_map(row)
    assert (row["year"], row["year_published"], row["scale_denom"]) == (1966, 1972, 24000)
    assert round(row["rmse_m"], 1) == 12.2 and ingest.usable(row["rmse_m"]) and not ingest.usable(ut.nmas_m(250000))
    assert "%2520Park" in row["tile_url"] and "projwin%3D-74.0%2C40.875%2C-73.875%2C40.75" in row["tile_url"]
    assert row["tile_url"].count("{z}") == 1 and ut.years("<procdesc>Survey Year</procdesc><procdate>1889</procdate>") == (1889, None)
    assert ut.to_row(item | {"urls": {}}, xml) is None


def test_allmaps_dates_and_rights_from_iiif_manifests():
    from strata.ingest import allmaps as am
    from tests.test_core import synthetic_gcps

    v3 = {"navDate": "1867-01-01T00:00:00Z", "rights": "http://rightsstatements.org/vocab/NoC-US/1.0/"}
    v2 = {"metadata": [{"label": "Title", "value": "Plan 1900 copy"}, {"label": "Date Created", "value": [{"@value": "ca. 1852"}]}]}
    assert am.from_manifest(v3) == (1867, "http://rightsstatements.org/vocab/NoC-US/1.0/")
    assert am.from_manifest(v2) == (1852, "see-source")  # the date label wins over a year in the title
    assert am.earliest(2023, "Map of the City of Newark from Pierson's Directory 1853") == 1853
    assert am.earliest(1867, "Plan 1900 copy") == 1867  # a later year in the title is not a scan date
    assert am.from_manifest({"metadata": [{"label": {"en": ["Subject"]}, "value": {"en": ["Maps"]}}]})[0] is None

    gcps = synthetic_gcps()
    feat = {"geometry": SQUARE, "properties": {
        "id": "https://annotations.allmaps.org/maps/8d36b34061eda327",
        "resource": {"id": "https://tile.loc.gov/image-services/iiif/service:gmd:x", "partOf": [
            {"type": "Canvas", "partOf": [{"type": "Manifest", "id": "https://www.loc.gov/item/2005625335/manifest.json",
                                           "label": {"none": ["Commissioners' plan"]}}]}]},
        "transformation": {"type": "thinPlateSpline"},
        "gcps": [{"resource": [px, py], "geo": [lon, lat]} for px, py, lon, lat in gcps]}}
    assert am.manifest_url(feat) == "https://www.loc.gov/item/2005625335/manifest.json"
    row, out = am.to_row(feat, 1811, "no-known-restrictions", "https://www.loc.gov/item/2005625335/", "Commissioners' plan")
    ingest.check_map(row)
    assert (row["id"], row["source"], row["method"]) == ("allmaps:8d36b34061eda327", "tile.loc.gov", "tps") and len(out) == 6

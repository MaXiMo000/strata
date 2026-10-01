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


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs a PostGIS test DB (DATABASE_URL)")
def test_upsert_map_twice_leaves_one_row():
    with ingest.connect() as conn:
        for title in ("first", "second"):
            ingest.upsert_map(conn, MAP | {"title": title})
            ingest.upsert_gcps(conn, MAP["id"], [(0, 0, -74.0, 40.7), (1, 1, -73.9, 40.8)])
        assert conn.execute("SELECT count(*), max(title) FROM maps WHERE id = %s", (MAP["id"],)).fetchone() == (1, "second")
        assert conn.execute("SELECT count(*) FROM gcps WHERE map_id = %s", (MAP["id"],)).fetchone() == (2,)
        conn.rollback()  # leave the catalog untouched

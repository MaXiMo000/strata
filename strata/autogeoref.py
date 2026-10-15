"""Automatic georeferencing, step one: street intersections read off the scan -> control points -> a robust affine.

1. Tiles of the IIIF image go to Claude, which lists the street intersections it can read, with pixel positions.
2. Each intersection is looked up in today's OpenStreetMap (a node shared by two named ways inside NYC).
   Ambiguous names ("West 33rd Street" exists in Manhattan and Coney Island) keep every candidate.
3. RANSAC picks the affine that the most candidates agree with; leave-one-out RMSE says how good it is.

Run against a map that is already georeferenced to measure the error against its hand-placed control points:
    python -m strata.autogeoref nypl:85e54acdc421afe4 [--tiles 2]
Needs the optional dependency: pip install -e ".[autogeoref]" and Anthropic credentials (ANTHROPIC_API_KEY).
"""
import argparse
import base64
import json
import math
import random

import numpy as np

from .georef import R, fit_affine, loo_rmse_m, to_mercator
from .ingest import NYC_BBOX, connect, get, get_json

MODEL = "claude-opus-5-5"
OVERPASS = "https://overpass-api.de/api/interpreter"
INLIER_M = 40.0  # a candidate within this many ground metres of the model agrees with it

PROMPT = """This is part of a scanned historical map of New York City ({w} x {h} pixels).
List every street intersection you can read: places where two labelled streets cross or meet.
For each, give both street names as printed, the same names spelled out in modern form (e.g. "W. 33d St." ->
"West 33rd Street", "5th Av." -> "5th Avenue", "B'way" -> "Broadway"), and the pixel position of the crossing
centre (x to the right, y down, origin top-left of this image). Only include intersections where you can read
both names; skip anything you'd be guessing."""

SCHEMA = {
    "type": "object",
    "properties": {"intersections": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "street_a": {"type": "string"}, "street_b": {"type": "string"},
            "modern_a": {"type": "string"}, "modern_b": {"type": "string"},
            "x": {"type": "number"}, "y": {"type": "number"},
        },
        "required": ["street_a", "street_b", "modern_a", "modern_b", "x", "y"],
        "additionalProperties": False,
    }}},
    "required": ["intersections"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- 1. read the scan
def tiles(width: int, height: int, n: int, size: int = 1500) -> list[tuple[int, int, int, int, int]]:
    """n x n regions (x, y, w, h) of the full image, each fetched at `size` px wide (the IIIF server scales)."""
    tw, th = math.ceil(width / n), math.ceil(height / n)
    return [(i * tw, j * th, min(tw, width - i * tw), min(th, height - j * th), size) for j in range(n) for i in range(n)]


def read_intersections(image_service: str, n: int = 2) -> list[dict]:
    """Intersections in full-resolution pixel coordinates, from n x n tiles of the image."""
    import anthropic  # optional dependency, only this step needs it

    client = anthropic.Anthropic()
    info = get_json(image_service.rstrip("/") + "/info.json")
    found = []
    for x, y, w, h, size in tiles(info["width"], info["height"], n):
        jpeg = get(f"{image_service.rstrip('/')}/{x},{y},{w},{h}/{size},/0/default.jpg")
        scale = w / size  # tile pixels -> full-resolution pixels
        tile_h = round(h / scale)
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",  # a safety decline is retried on a fallback model instead of failing the tile
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.standard_b64encode(jpeg).decode()}},
                {"type": "text", "text": PROMPT.format(w=size, h=tile_h)},
            ]}],
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            print(f"  tile {x},{y}: stopped ({response.stop_reason}), skipped")
            continue
        text = next(b.text for b in response.content if b.type == "text")
        for it in json.loads(text)["intersections"]:
            found.append(it | {"px": x + it["x"] * scale, "py": y + it["y"] * scale})
        print(f"  tile {x},{y}: {len(json.loads(text)['intersections'])} intersections")
    return found


# ---------------------------------------------------------------- 2. find them today
def osm_candidates(a: str, b: str, bbox=NYC_BBOX) -> list[tuple[float, float]]:
    """(lon, lat) of every node shared by a way named `a` and a way named `b` inside bbox."""
    s, w, n, e = bbox[1], bbox[0], bbox[3], bbox[2]
    esc = lambda name: name.replace('"', '\\"')  # noqa: E731
    q = (f'[out:json][timeout:25];way["highway"]["name"="{esc(a)}"]({s},{w},{n},{e})->.a;'
         f'way["highway"]["name"="{esc(b)}"]({s},{w},{n},{e})->.b;node(w.a)(w.b);out;')
    nodes = json.loads(get(OVERPASS, {"data": q}))["elements"]
    # Wide streets give several nodes per crossing: merge nodes within ~30 m into one candidate.
    out: list[tuple[float, float]] = []
    for nd in nodes:
        p = (nd["lon"], nd["lat"])
        if all(ground_m(p, q2) > 30 for q2 in out):
            out.append(p)
    return out


def ground_m(p: tuple[float, float], q: tuple[float, float]) -> float:
    (x1, y1), (x2, y2) = to_mercator(*p), to_mercator(*q)
    return math.hypot(x1 - x2, y1 - y2) * math.cos(math.radians((p[1] + q[1]) / 2))


# ---------------------------------------------------------------- 3. robust fit
def apply(M: np.ndarray, px: float, py: float) -> tuple[float, float]:
    """Pixel -> (lon, lat) through an affine to EPSG:3857."""
    x, y = M @ np.array([px, py, 1.0])
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def ransac(cands: list[tuple[float, float, list[tuple[float, float]]]], iterations: int = 2000, seed: int = 0):
    """cands: (px, py, [possible (lon, lat)]). Returns (affine, inlier GCPs) with the most agreeing points, or None."""
    rng = random.Random(seed)
    flat = [(px, py, lon, lat) for px, py, opts in cands for lon, lat in opts]
    if len({(c[0], c[1]) for c in flat}) < 3:
        return None
    best: list[tuple] = []
    for _ in range(iterations):
        sample = rng.sample(flat, 3)
        if len({(s[0], s[1]) for s in sample}) < 3:
            continue
        try:
            M = fit_affine(sample)
        except np.linalg.LinAlgError:
            continue
        inliers = []
        for px, py, opts in cands:  # each pixel point counts once, with its best-matching candidate
            d, ll = min((ground_m(apply(M, px, py), o), o) for o in opts)
            if d <= INLIER_M:
                inliers.append((px, py, *ll))
        if len(inliers) > len(best):
            best = inliers
    if len(best) < 4:
        return None
    return fit_affine(best), best


def evaluate(M: np.ndarray, truth: list[tuple]) -> dict:
    """Ground-metre error of the automatic affine at the hand-placed control points."""
    errs = sorted(ground_m(apply(M, px, py), (lon, lat)) for px, py, lon, lat in truth)
    return {"median_m": round(errs[len(errs) // 2], 1), "max_m": round(errs[-1], 1), "points": len(errs)}


# ---------------------------------------------------------------- CLI: one already-georeferenced map, measured
def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="python -m strata.autogeoref")
    ap.add_argument("map_id", help="a catalogued map with control points, e.g. nypl:85e54acdc421afe4")
    ap.add_argument("--tiles", type=int, default=2, help="n x n tiles per scan (cost scales with n squared)")
    a = ap.parse_args(argv)
    with connect() as conn:
        image, annotation = conn.execute("SELECT iiif_manifest, georef_annotation FROM maps WHERE id = %s", (a.map_id,)).fetchone()
        truth = conn.execute("SELECT px, py, lon, lat FROM gcps WHERE map_id = %s", (a.map_id,)).fetchall()
    # The control points were placed on the image size the annotation names; rescale them to today's image.
    ann = get_json("https://api.allmaps.org/maps/" + annotation.rsplit("/", 1)[-1])["resource"]
    info = get_json(image.rstrip("/") + "/info.json")
    sx, sy = info["width"] / ann["width"], info["height"] / ann["height"]
    truth = [(px * sx, py * sy, lon, lat) for px, py, lon, lat in truth]

    print(f"{a.map_id}: reading {a.tiles}x{a.tiles} tiles")
    found = read_intersections(image, a.tiles)
    cands = []
    for it in found:
        try:
            opts = osm_candidates(it["modern_a"], it["modern_b"])
        except Exception as e:  # a busy public Overpass server shouldn't sink the whole map
            print(f"  {it['modern_a']} & {it['modern_b']}: lookup failed ({e.__class__.__name__}), skipped")
            continue
        print(f"  {it['modern_a']} & {it['modern_b']}: {len(opts)} OSM match(es)")
        if opts:
            cands.append((it["px"], it["py"], opts))
    fit = ransac(cands)
    if not fit:
        print(f"no fit: {len(cands)} geocoded intersections, need 4 agreeing")
        return
    M, inliers = fit
    print(json.dumps({"intersections_read": len(found), "geocoded": len(cands), "inliers": len(inliers),
                      "loo_rmse_m": round(loo_rmse_m(inliers), 1), "vs_hand_gcps": evaluate(M, truth)}, indent=1))


if __name__ == "__main__":
    main()

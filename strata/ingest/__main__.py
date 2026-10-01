"""python -m strata.ingest <source> [--bbox minlon,minlat,maxlon,maxlat]"""
import argparse
import importlib

from . import NYC_BBOX, connect


def parse_bbox(s: str) -> tuple[float, float, float, float]:
    b = tuple(float(x) for x in s.split(","))
    if len(b) != 4 or not (b[0] < b[2] and b[1] < b[3]):
        raise argparse.ArgumentTypeError("bbox is minlon,minlat,maxlon,maxlat")
    return b


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="python -m strata.ingest")
    p.add_argument("source", help="module in strata/ingest, e.g. nypl_warper, usgs_topo, allmaps")
    p.add_argument("--bbox", type=parse_bbox, default=NYC_BBOX, help="default: New York City. Use --bbox=... (values start with -)")
    a = p.parse_args(argv)
    source = importlib.import_module(f"strata.ingest.{a.source}")
    with connect() as conn:
        n = source.run(conn, a.bbox)
    print(f"{a.source}: {n} maps upserted")


if __name__ == "__main__":
    main()

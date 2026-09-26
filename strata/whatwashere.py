"""'What stood here in year Y' from Wikidata: items near a point with inception (P571) / dissolved (P576) dates."""
import httpx

SPARQL = "https://query.wikidata.org/sparql"
QUERY = """
SELECT ?item ?itemLabel ?start ?end ?dist WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(%(lon)f %(lat)f)"^^geo:wktLiteral ;
                    wikibase:radius "%(km)f" ;
                    wikibase:distance ?dist .
  }
  OPTIONAL { ?item wdt:P571 ?start }
  OPTIONAL { ?item wdt:P576 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?dist LIMIT 200
"""


def _year(binding: dict, key: str) -> int | None:
    v = binding.get(key, {}).get("value")
    if not v:
        return None
    return -int(v[1:5]) if v.startswith("-") else int(v[:4])  # xsd:dateTime, BCE starts with '-'


def existed_in(start: int | None, end: int | None, year: int) -> bool:
    """Unknown inception date = can't place it in time, so exclude it rather than guess."""
    return start is not None and start <= year and (end is None or end >= year)


def what_was_here(lat: float, lon: float, year: int, km: float = 0.15) -> list[dict]:
    r = httpx.get(
        SPARQL,
        params={"query": QUERY % {"lat": lat, "lon": lon, "km": km}, "format": "json"},
        headers={"User-Agent": "strata/0.0 (https://github.com/MaXiMo000/strata)"},  # required by Wikidata policy
        timeout=30,
    )
    r.raise_for_status()
    out = []
    for b in r.json()["results"]["bindings"]:
        start, end = _year(b, "start"), _year(b, "end")
        if existed_in(start, end, year):
            out.append({
                "wikidata": b["item"]["value"],
                "name": b["itemLabel"]["value"],
                "start": start,
                "end": end,
                "distance_m": round(float(b["dist"]["value"]) * 1000),
            })
    return out

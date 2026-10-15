"""What stood here, and when: dated places near a point, from Wikidata and OpenHistoricalMap.

Wikidata items count only if they are (subclasses of) an architectural structure, park, square or monument: the
area around a Manhattan address is otherwise full of radio stations and companies registered there. OpenHistoricalMap
contributes named buildings and amenities with start/end dates; streets, rail lines and boundaries are left out.
"""
import re

import httpx

UA = {"User-Agent": "strata/0.0 (+https://github.com/MaXiMo000/strata)"}  # both services ask for one
SPARQL = "https://query.wikidata.org/sparql"
OVERPASS_OHM = "https://overpass-api.openhistoricalmap.org/api/interpreter"
QUERY = """
SELECT ?item ?itemLabel ?start ?end ?dist WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(%(lon)f %(lat)f)"^^geo:wktLiteral ;
                    wikibase:radius "%(km)f" ;
                    wikibase:distance ?dist .
  }
  ?item wdt:P571 ?start .
  FILTER EXISTS { VALUES ?root { wd:Q811979 wd:Q22698 wd:Q174782 wd:Q4989906 } ?item wdt:P31/wdt:P279* ?root }
  OPTIONAL { ?item wdt:P576 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?dist LIMIT 200
"""
PLACE_KEYS = ("building", "amenity", "historic", "leisure", "man_made", "tourism", "shop")
YEAR = re.compile(r"-?\d{4}")


def _year(value: str | None) -> int | None:
    """First year in an xsd:dateTime ("1931-01-01T00:00:00Z", "-0500-...") or an OHM date ("1917-06-03", "~1850")."""
    m = YEAR.search(value or "")
    return int(m.group()) if m else None


def existed_in(start: int | None, end: int | None, year: int) -> bool:
    """Unknown inception date = can't place it in time, so exclude it rather than guess."""
    return start is not None and start <= year and (end is None or end >= year)


def wikidata_places(lat: float, lon: float, km: float = 0.15) -> list[dict]:
    r = httpx.get(SPARQL, params={"query": QUERY % {"lat": lat, "lon": lon, "km": km}, "format": "json"}, headers=UA, timeout=30)
    r.raise_for_status()
    out = {}
    for b in r.json()["results"]["bindings"]:
        out.setdefault(b["item"]["value"], {
            "name": b["itemLabel"]["value"], "start": _year(b["start"]["value"]), "end": _year(b.get("end", {}).get("value")),
            "distance_m": round(float(b["dist"]["value"]) * 1000), "source": "wikidata", "url": b["item"]["value"],
        })
    return list(out.values())


def ohm_places(lat: float, lon: float, m: int = 150) -> list[dict]:
    q = f'[out:json][timeout:25];nwr(around:{m},{lat},{lon})["start_date"]["name"];out tags center 200;'
    r = httpx.post(OVERPASS_OHM, data={"data": q}, headers=UA, timeout=40)
    r.raise_for_status()
    return [{
        "name": e["tags"]["name"], "start": _year(e["tags"].get("start_date")), "end": _year(e["tags"].get("end_date")),
        "distance_m": None, "source": "ohm", "url": f"https://www.openhistoricalmap.org/{e['type']}/{e['id']}",
    } for e in r.json().get("elements", []) if any(e["tags"].get(k, "no") != "no" for k in PLACE_KEYS)]


def merge(*lists: list[dict]) -> list[dict]:
    """One entry per place name (the first source wins, so pass Wikidata first), dated ones only, oldest first."""
    seen = {}
    for p in (p for lst in lists for p in lst):
        key = re.sub(r"\W+", " ", p["name"].casefold()).strip()
        if p["start"] is not None and key not in seen:
            seen[key] = p
    return sorted(seen.values(), key=lambda p: (p["start"], p["end"] or 9999))


def history(lat: float, lon: float) -> list[dict]:
    """Every dated place near the point, whatever the year (the core sample draws them as lifespans)."""
    lists = []
    for fetch in (wikidata_places, ohm_places):
        try:
            lists.append(fetch(lat, lon))
        except httpx.HTTPError:
            lists.append([])  # one source down shouldn't empty the other
    return merge(*lists)


def what_was_here(lat: float, lon: float, year: int) -> list[dict]:
    return [p for p in history(lat, lon) if existed_in(p["start"], p["end"], year)]

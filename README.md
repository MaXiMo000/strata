# strata

**A time-travel map.** Type any address and slide a year slider back to see what stood there in 1850, 1920, or 1970.
strata georeferences (aligns) old public-domain maps from the Library of Congress, NYPL, USGS, David Rumsey, and
others into map tiles, and ties every layer together in one query API: *"best maps for this point in this year"*.

```
350 5th Ave, New York   (illustrative: the catalog fills in Phase 1–2)
  1916  Sanborn fire-insurance atlas, sheet 42  (±6 m)    → Waldorf-Astoria (1893–1929)
  1955  USGS 1:24,000 Central Park quad         (±12 m)   → Empire State Building (1931–)
```

> Status: **scaffold / Phase 0.** Working today: the query API (`/api/timeline`, `/api/layers`, `/api/whatwashere`),
> georeferencing math (affine fit, leave-one-out error in meters, bad-GCP detection, GDAL command generation), and a
> MapLibre page with address search, a snapping year slider, an opacity control, and Wikidata "what was here" facts.
> The catalog is empty until the Phase 1 ingesters run. See [docs/PLAN.md](docs/PLAN.md).

## Run it

```bash
python -m venv .venv && . .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate elsewhere
pip install -e ".[dev]"
pytest
docker compose up -d db                           # PostGIS with schema.sql applied
uvicorn strata.api:app --reload                   # http://localhost:8000
```

## Docs

- [docs/PLAN.md](docs/PLAN.md): phases, tasks, acceptance criteria
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system, data model, ranking, tiles, API
- [docs/GEOREFERENCING.md](docs/GEOREFERENCING.md): the hard part: GCPs, transforms, error, auto-georeferencing
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md): collections, endpoints, and **licenses**
- [docs/KICKOFF.md](docs/KICKOFF.md): the prompt to start a new Claude Code session on this repo

## License

Code: MIT. Map images keep their source licenses, which are stored per layer in `maps.license`.

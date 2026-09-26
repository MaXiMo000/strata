# strata: agent guide

Time-travel map: address + year slider → aligned historical map layers + "what stood here".

## Read first
1. `docs/PLAN.md`: phases with checkboxes. **Work on the first unticked task.** Tick boxes as you finish.
2. `docs/ARCHITECTURE.md`: system, data model, ranking, tiles.
3. `docs/GEOREFERENCING.md`: GCPs, transforms, error metrics, the auto-georeferencing research plan.
4. `docs/DATA_SOURCES.md`: collections, endpoints, licenses.

## Commands
```bash
python -m venv .venv && . .venv/Scripts/activate && pip install -e ".[dev]"
pytest -q
docker compose up -d db                        # PostGIS + schema.sql (first start only)
docker compose --profile tiles up -d titiler   # when serving our own COGs (Phase 1c)
uvicorn strata.api:app --reload                # http://localhost:8000
```
If the schema changes, the init script won't re-run on an existing volume: `docker compose down -v` (destroys local data)
or apply an ALTER by hand.

## Layout
- `strata/api.py`: FastAPI: `/api/timeline`, `/api/layers`, `/api/whatwashere`; serves `web/`
- `strata/georef.py`: affine fit, residuals (ground m), `loo_rmse_m`, `worst_gcp`, `gdal_commands`
- `strata/whatwashere.py`: Wikidata SPARQL around a point, filtered by year
- `strata/ingest/*.py`: (Phase 1) one module per source, run as `python -m strata.ingest <source>`
- `web/index.html`: MapLibre single page, no build step
- `schema.sql`: PostGIS schema

## Rules
- Keep it small: stdlib, numpy, and existing deps first. No new framework (no React; no ORM, since raw SQL via psycopg is fine).
- Every map row needs `license`, `year`, `footprint` (warped mask, not the bbox), and `tile_url`; `rmse_m` whenever GCPs exist.
- Before adding a tile source: `curl -sI <a tile URL> | grep -i access-control-allow-origin` must print something.
- Pilot city is NYC. Don't ingest other cities until Phase 1 acceptance passes.
- Be polite to sources: cache responses, send a descriptive User-Agent, rate-limit (~1 req/s), and never bulk-download
  what we can reference by URL instead.
- Tests never hit the network or require Docker (DB tests skip without `DATABASE_URL`).
- Commit after each ticked task with a clear message; push to `origin main`.

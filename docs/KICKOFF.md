# Session kickoff prompt

Paste this into a fresh Claude Code session opened in this repo's folder:

---

You're picking up **strata**, a time-travel map. Type an address and slide a year slider back to see what stood there,
using georeferenced historical maps (LOC Sanborn, NYPL Map Warper, USGS topos, Allmaps annotations) tied together by
one query API. The pilot city is New York.

**The UI bar is high: it must be striking and must not look AI-generated.** No 3D, but it has to stand next to my other
projects. Before any UI work, study them on disk: `../portfolio/web/src/styles.css` and `../portfolio/README.md` (the "Design"
section), `../tidewatch/frontend/src/style.css`, and `../afterglow-src/afterglow/docs/EXPERIENCE.md` +
`../afterglow-src/afterglow/frontend/src/style.css`. Match their craft (tokens with rules, one reserved signal colour,
serif + mono pairing, hairlines, a thin HUD over a full-bleed scene, pacing), but follow this project's own identity in
`docs/DESIGN.md`: a near-invisible dark base map so the historical maps are the only colour, the huge Fraunces year numeral,
the notched ruler, and the core sample.

1. Read `CLAUDE.md`, then `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/GEOREFERENCING.md`, `docs/DATA_SOURCES.md`,
   `docs/DESIGN.md` in full before writing code.
2. Get the baseline running: `pip install -e ".[dev]" && pytest -q`, then `docker compose up -d db` and
   `uvicorn strata.api:app --reload`. Confirm `/api/timeline?lat=40.7484&lon=-73.9857` returns `[]` (empty catalog).
3. Find the first unticked task in `docs/PLAN.md` (Phase 1a, the ingest framework). Work through tasks **in order**:
   - before writing an ingester, look up the source's **current** API with web search and try one real request,
     since the endpoints in DATA_SOURCES.md may have drifted. Update the doc if they have.
   - check every tile source for CORS (`curl -sI … | grep -i access-control`) before storing its `tile_url`
   - store license, survey year, the warped footprint, and `rmse_m` (via `strata.georef.loo_rmse_m`) for every map
   - add one focused test per non-trivial function; `pytest -q` must stay green
   - for UI tasks (Phase 1e is the big design build): open it in the browser, screenshot at 390 and 1440 wide, check it
     against the DESIGN.md anti-"AI look" list and quality bar, and fix what fails. Show me the screenshots
   - tick the box, commit with a descriptive message, `git push`
4. After each ingester lands, open the app in the browser, search "350 5th Avenue, New York", and check the slider
   shows the new years with no console errors. Take a screenshot for me.
5. At the end of Phase 1, run the acceptance check (5 random Manhattan addresses, ≥ 4 years each; Lighthouse), put the results
   plus a 1440 screenshot in the README "Status" section, and summarise for me what's done and what's next.

Guardrails: pilot city only (NYC) until Phase 1 passes; respect source rate limits and send a User-Agent; never drop the
license field; prefer referencing source/Allmaps tiles over downloading and re-hosting. If a design decision in the docs
turns out wrong, update the doc in the same commit and tell me why.

Start now with Phase 1a.

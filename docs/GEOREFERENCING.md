# Georeferencing: the hard part

Goal: turn a scanned map image into something that sits correctly on today's map, and know how wrong it still is.

## 1. Ground control points (GCPs)

A GCP pairs a pixel on the scan `(px, py)` with a real location `(lon, lat)`.

What makes a good GCP:
- **Street intersections** (the centre of the crossing), survey benchmarks, church/courthouse corners, bridge ends.
- **Things that haven't moved.** Shorelines, rivers and railways move; landfill moved Manhattan's shoreline by hundreds of meters.
- **Spread across the whole sheet.** Corners + middle. Clustered GCPs extrapolate badly at the edges.
- **6–20 per map.** An affine fit needs ≥ 3, leave-one-out error ≥ 4, and TPS benefits from many.

## 2. Transforms

| Method | Parameters | Use for | GDAL |
|---|---|---|---|
| Affine (1st-order polynomial) | 6 | Accurate surveys at large scale: Sanborn, USGS, OS | `gdalwarp -order 1` |
| 2nd/3rd-order polynomial | 12 / 20 | Mild, smooth distortion (paper shrinkage, projection mismatch) | `-order 2` / `-order 3` |
| Thin plate spline (TPS) | exact through every GCP | Hand-drawn / pre-1850 / locally distorted maps | `-tps` |

Rules of thumb:
- **Start affine.** Look at the residuals. Only escalate if the residuals show a *pattern* (e.g. growing towards one corner).
- **TPS hides bad GCPs**: it passes exactly through every point, so a misplaced GCP locally distorts the map instead of
  showing up as error. Always check GCPs with an affine fit before a TPS warp. `georef.worst_gcp()` flags the outlier.
- Unknown source projection doesn't matter much at city scale; the polynomial/TPS absorbs it.

## 3. Measuring error (what `rmse_m` means)

- **Fit RMSE** (`georef.rmse_m`) is the residual of the GCPs used in the fit. It's optimistic: 0 with exactly 3 GCPs, and always 0 for TPS.
- **Leave-one-out RMSE** (`georef.loo_rmse_m`): refit without each GCP, then measure how far off that GCP lands. It's honest
  for any method, and it's what we store and show.
- Distances are computed in EPSG:3857 and **multiplied by cos(latitude)**. Mercator meters are inflated by
  1/cos(lat) (≈ 1.32× in NYC), so skipping the correction overstates error by a third.

Typical numbers:

| Map type | Expected LOO RMSE |
|---|---|
| Sanborn 1:600 sheet, affine, 8+ intersections | 2–10 m |
| USGS 1:24,000 topo | ~12 m (the National Map Accuracy Standard) |
| 1890s city atlas plate | 10–30 m |
| 1850 bird's-eye / hand-drawn city plan, TPS | 50–200 m |

## 4. Automatic georeferencing (Phase 4 research)

Classic image matching (SIFT/ORB/LoFTR) **fails** between a 1900 engraving and today's map tiles: the styles have
nothing in common. What works is matching **semantics**, not pixels:

### 4a. Text → coarse GCPs
1. Find the text on the map: **mapKurator** (the "Machines Reading Maps" project, University of Minnesota's Knowledge
   Computing Lab) detects and reads map labels. Alternatively, send 1024 px tiles to a vision LLM and ask for
   `[{text, bbox}]` for street names.
2. Pair labels that cross (two street names whose boxes are near-perpendicular and adjacent) → an intersection.
3. Geocode the intersection against OSM (Overpass: the node shared by two ways with those names, inside the city bbox).
4. RANSAC over the candidate GCPs with an affine model. Keep the consensus set; accept if LOO RMSE < 25 m.

Pitfalls: renamed streets (look up historical names via OpenHistoricalMap / Wikidata "replaced by"), OCR errors
("Brodway"), and duplicate street names across boroughs (restrict the bbox).

### 4b. Roads → fine GCPs
1. Extract the road network from the scan (a segmentation model; train a U-Net on Sanborn sheets georeferenced in Phase 2).
2. Skeletonise, then find the intersections (nodes of degree ≥ 3).
3. Project them with the 4a affine, then match each to the nearest OSM intersection within 40 m. RANSAC again.
4. Refit with the enlarged GCP set (poly2 or TPS) and report the LOO RMSE.

### 4c. Evaluation
Use the hand-georeferenced Sanborn sheets (Phase 2) as ground truth. Report the median and 90th-percentile LOO RMSE,
plus the % of sheets auto-accepted. A result is publishable when > 70% of sheets auto-georeference to < 15 m.

### 4d. Human in the loop
Maps below the confidence bar open in **Allmaps Editor** pre-filled with the auto GCPs; a person fixes 1–2 points.
Don't build your own editor.

## 5. Tools

- **GDAL**: `gdal_translate -gcp`, `gdalwarp -order/-tps`, `-of COG`. The recipe is in `georef.gdal_commands`.
- **Allmaps**: an editor + viewer + tile server for IIIF images, using the W3C "Georeference Annotation" format.
- **QGIS Georeferencer**: good for one-off manual work and for checking residuals visually.
- **NYPL Map Warper**: an open-source Rails app, and the source of thousands of existing NYC GCP sets. NYPL's instance was
  archived in 2021; its GCPs now live in Allmaps (see DATA_SOURCES.md).

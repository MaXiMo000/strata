# strata: data sources

Check each item's rights statement at ingest; store it in `maps.license`. Endpoints drift, so verify before relying on them.

| Collection | What | Access | License | Georeferenced already? |
|---|---|---|---|---|
| **LOC Sanborn Fire Insurance Maps** | ~700k sheets, 1867–1970, 12,000+ US towns; building footprints, materials, floors, house numbers | `https://www.loc.gov/collections/sanborn-maps/?fo=json` (+ `&fa=location:…`), IIIF per item | US works published before 1931 are public domain; check each item's rights field for later ones | Partly (community work in Allmaps) |
| **LOC Geography & Map Division** (general) | City plans, panoramic maps, atlases | `https://www.loc.gov/maps/?fo=json`, IIIF | mostly "no known restrictions" | Some via Allmaps |
| **NYPL Map Warper** | Thousands of NYC/NJ atlas sheets and maps, already warped | `https://maps.nypl.org/warper/` (JSON API for maps, GCPs, layers; XYZ tiles per map/layer) | NYPL public-domain items | **Yes** |
| **NYPL Digital Collections** | The IIIF source images | `https://api.repo.nypl.org/` (free token) | public domain where marked | via Warper/Allmaps |
| **USGS Historical Topographic Map Collection** | Every USGS topo since 1884, national | TNM Access API `https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Historical%20Topographic%20Maps&bbox=…`; topoView UI | US Government, **public domain** | **Yes** (GeoTIFF/GeoPDF) |
| **David Rumsey Map Collection** | 150k+ maps worldwide, many georeferenced | Luna viewer, IIIF, georeferencer | **CC BY-NC-SA 3.0**: non-commercial only | Many |
| **National Library of Scotland** | Ordnance Survey (UK) 1840s–1970s, plus other countries | `maps.nls.uk`; georeferenced layers / tile services | varies: many CC-BY; some tiles restricted (check) | **Yes** |
| **Allmaps** | Georeference annotations over IIIF from many institutions | `https://annotations.allmaps.org/…`, tile server `allmaps.xyz` | inherits the source image license | **Yes** |
| **OldMapsOnline** | A discovery index across collections | web | links out | no |
| **Internet Archive** | Scanned atlases | `archive.org/advancedsearch.php`, IIIF | varies | no |
| **OpenHistoricalMap** | Vector history with `start_date`/`end_date` | Overpass API for OHM; vector tiles | CC0 | n/a (vector) |
| **Wikidata** | Buildings/places with coordinates (P625), inception (P571), dissolved/demolished (P576) | `https://query.wikidata.org/sparql` (send a descriptive User-Agent) | CC0 | n/a |
| **USGS EarthExplorer aerials** | Historical aerial photo single frames, 1930s+ | EarthExplorer (free account) / M2M API | public domain | no (Phase 5) |

## Supporting services

| Need | Choice | Notes |
|---|---|---|
| Geocoding | Photon (`photon.komoot.io`), fair use | For production: self-host Photon/Nominatim, or Geocode Earth/MapTiler. Nominatim's public server forbids heavy use. |
| Base map | OSM tiles (dev only) | The OSM tile policy forbids heavy use. Production: MapTiler, Stadia, or self-hosted Protomaps PMTiles. |
| COG tile serving | TiTiler (`ghcr.io/developmentseed/titiler`) | Stateless; put a CDN in front. |
| Storage | Cloudflare R2 | Free egress matters for tiles. |

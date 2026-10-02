// The modern city, almost invisible: land is the ground, roads are hairlines, labels a quiet vellum. The historical maps
// are the only colour on screen (docs/DESIGN.md "Base map"). Built from the CSS tokens so there is one source of truth.
// Tiles: OpenFreeMap (OpenMapTiles schema, OSM data, no key, production use allowed). Attribution is required.
import type { StyleSpecification } from "maplibre-gl";

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const LABEL_LAYERS = ["street-names", "place-names", "water-names"];

/** today = true: the same city turned up for the swipe's "today" side, where the modern map is the content. */
export function baseStyle(today = false): StyleSpecification {
  const night = token("--night"), water = token("--water"), vellum = token("--vellum"), slate = token("--slate");
  // --hair is vellum at 8%; MapLibre wants the parts, so roads use vellum with that opacity (never brighter).
  const hair = today ? 0.34 : 0.08;
  const bldg = today ? 0.16 : 0.018;
  const label = {
    "text-font": ["Noto Sans Regular"],
    "text-transform": "uppercase" as const,
    "text-letter-spacing": 0.22,
  };
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "land", type: "background", paint: { "background-color": night } },
      { id: "water", type: "fill", source: "osm", "source-layer": "water", paint: { "fill-color": water } },
      { id: "parks", type: "fill", source: "osm", "source-layer": "park", paint: { "fill-color": vellum, "fill-opacity": 0.018 } },
      {
        id: "buildings", type: "fill", source: "osm", "source-layer": "building", minzoom: 14,
        paint: { "fill-color": vellum, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, bldg] },
      },
      {
        id: "roads", type: "line", source: "osm", "source-layer": "transportation",
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": vellum,
          "line-opacity": ["match", ["get", "class"], ["minor", "service"], hair * 0.7, hair],
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.5, 15,
            ["match", ["get", "class"], ["motorway", "trunk", "primary"], 3, ["secondary", "tertiary"], 2.2, 1.2], 18,
            ["match", ["get", "class"], ["motorway", "trunk", "primary"], 14, ["secondary", "tertiary"], 11, 7]],
        },
      },
      {
        id: "rail", type: "line", source: "osm", "source-layer": "transportation", minzoom: 13,
        filter: ["==", ["get", "class"], "rail"],
        paint: { "line-color": vellum, "line-opacity": hair, "line-width": 1, "line-dasharray": [3, 3] },
      },
      {
        id: "water-names", type: "symbol", source: "osm", "source-layer": "water_name",
        layout: { ...label, "text-field": ["get", "name:en"], "text-size": 11, "text-letter-spacing": 0.4 },
        paint: { "text-color": slate, "text-opacity": 0.55 },
      },
      {
        id: "street-names", type: "symbol", source: "osm", "source-layer": "transportation_name", minzoom: 14,
        layout: { ...label, "symbol-placement": "line", "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-size": 10 },
        paint: { "text-color": vellum, "text-opacity": 0.62, "text-halo-color": night, "text-halo-width": 0.9, "text-halo-blur": 0.8 },
      },
      {
        id: "place-names", type: "symbol", source: "osm", "source-layer": "place",
        filter: ["match", ["get", "class"], ["city", "borough", "suburb", "quarter", "neighbourhood"], true, false],
        layout: { ...label, "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-size": ["match", ["get", "class"], ["city", "borough"], 12, 10] },
        paint: { "text-color": vellum, "text-opacity": 0.7, "text-halo-color": night, "text-halo-width": 0.9, "text-halo-blur": 0.8 },
      },
    ],
  };
}

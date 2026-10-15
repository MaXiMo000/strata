// Everything that needs MapLibre: the map, historical layers, the pin and its accuracy halo, the "today" map for swipe
// compare, and the poster. Loaded on first intent (main.ts), so the arrival screen never pays for it.
import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
// MapLibre 6 finds its worker next to its own module, which bundling breaks: hand Vite the worker to bundle instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { LABEL_LAYERS, baseStyle } from "./basemap";
import { History } from "./layers";
import type { Layer, Place } from "./api";

export const START = { center: [-73.9967, 40.7306] as [number, number], zoom: 13.2 };
const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** A circle of `m` metres around the point, as a polygon: the honest size of "you are here" on this map. */
function circle(lon: number, lat: number, m: number) {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lon + (m * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (m * Math.sin(a)) / 110540]);
  }
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}

export function createScene(onMoveEnd: () => void) {
  maplibregl.setWorkerUrl(workerUrl);
  const map = new maplibregl.Map({
    container: "map",
    style: baseStyle(),
    center: START.center,
    zoom: START.zoom,
    maxPitch: 0, // WarpedMapLayer doesn't support pitch
    dragRotate: false,
    attributionControl: { compact: true },
    canvasContextAttributes: { preserveDrawingBuffer: true }, // the poster reads the canvas back
  });
  map.touchZoomRotate.disableRotation();
  map.on("error", (e) => console.error("map:", e.error?.message ?? e)); // tile/CORS failures must be visible
  map.on("moveend", onMoveEnd);
  if (import.meta.env.DEV) Object.assign(window, { strataMap: map });
  const history = new History(map, LABEL_LAYERS[0]);

  // "load" waits for every initial tile, so one slow tile would hold everything back. Additions only need the style.
  const styleReady = new Promise<void>((resolve) => (map.isStyleLoaded() ? resolve() : map.once("style.load", () => resolve())));
  let pin: { place: Place | null; rmse: number | null } = { place: null, rmse: null };
  // The pin and its halo live on the main map and, while swiping, on the today map too.
  const pinMaps: maplibregl.Map[] = [];
  const drawPin = () => {
    const p = pin.place;
    for (const m of pinMaps) {
      (m.getSource("here") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
        features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }] : [] });
      (m.getSource("halo") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
        features: p && pin.rmse ? [circle(p.lon, p.lat, pin.rmse)] : [] });
    }
  };
  const addPin = (m: maplibregl.Map) => {
    m.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("halo", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const error = token("--error"), survey = token("--survey"), night = token("--night");
    m.addLayer({ id: "halo-fill", type: "fill", source: "halo", paint: { "fill-color": error, "fill-opacity": 0.12 } });
    m.addLayer({ id: "halo-line", type: "line", source: "halo", paint: { "line-color": error, "line-opacity": 0.7, "line-width": 1 } });
    m.addLayer({ id: "pin", type: "circle", source: "here",
      paint: { "circle-radius": 5, "circle-color": survey, "circle-stroke-color": night, "circle-stroke-width": 2 } });
    pinMaps.push(m);
    drawPin();
  };
  styleReady.then(() => addPin(map));
  // The still picture under the map fades once the live map has drawn (or after 4 s, whichever is first).
  const live = () => document.body.classList.add("live");
  map.once("idle", live);
  setTimeout(live, 4000);

  // "Today" for swipe compare: a second, non-interactive map in the base style turned up so the modern city reads,
  // clipped to the right of the line and following the main camera. Created on first use.
  let today: maplibregl.Map | null = null;

  return {
    map,
    zoom: () => map.getZoom(),
    setPin(place: Place | null, rmse: number | null) { pin = { place, rmse }; drawPin(); },
    fly(center: [number, number], zoom: number, instant: boolean) {
      if (instant) map.jumpTo({ center, zoom });
      else map.flyTo({ center, zoom, duration: 1200, easing: (t) => 1 - Math.pow(1 - t, 3) });
    },
    async show(layer: Layer | null, preload: Layer[] = []) { await styleReady; history.show(layer, preload); },
    get opacity() { return history.opacity; },
    setOpacity: (o: number) => history.setOpacity(o),
    setLabels(on: boolean) { for (const id of LABEL_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); },
    showToday() {
      if (!today) {
        const el = Object.assign(document.createElement("div"), { className: "today", ariaHidden: "true" });
        document.getElementById("map")!.after(el);
        today = new maplibregl.Map({ container: el, style: baseStyle(true), interactive: false, attributionControl: false,
          center: map.getCenter(), zoom: map.getZoom() });
        map.on("move", () => today!.jumpTo({ center: map.getCenter(), zoom: map.getZoom() }));
        today.once("style.load", () => addPin(today!));
      }
      today.resize();
    },
    /** The map canvas plus the year, address and credits, as a PNG data URL. */
    async poster(year: number, label: string, credit: string) {
      await document.fonts.ready;
      map.triggerRepaint();
      await new Promise((r) => map.once("render", r));
      const src = map.getCanvas(), dpr = devicePixelRatio || 1;
      const c = document.createElement("canvas");
      c.width = src.width; c.height = src.height;
      const g = c.getContext("2d")!;
      g.drawImage(src, 0, 0);
      const band = Math.round(c.height * 0.3);
      const grad = g.createLinearGradient(0, c.height - band, 0, c.height);
      grad.addColorStop(0, "rgba(7,9,11,0)"); grad.addColorStop(0.45, token("--scrim")); grad.addColorStop(1, token("--night"));
      g.fillStyle = grad; g.fillRect(0, c.height - band, c.width, band);
      const pad = 40 * dpr, size = Math.min(220 * dpr, c.width * 0.16);
      g.fillStyle = token("--survey");
      g.font = `300 ${size}px "Fraunces Variable"`;
      g.fillText(String(year), pad, c.height - pad - 34 * dpr);
      g.fillStyle = token("--vellum");
      g.font = `500 ${13 * dpr}px "IBM Plex Mono"`;
      g.fillText(label.toUpperCase(), pad, c.height - pad);
      g.fillStyle = token("--slate");
      g.font = `400 ${11 * dpr}px "IBM Plex Mono"`;
      g.textAlign = "right";
      g.fillText(credit, c.width - pad, c.height - pad);
      g.fillText("STRATA · BASE © OPENSTREETMAP · OPENFREEMAP", c.width - pad, c.height - pad - 18 * dpr);
      return c.toDataURL("image/png");
    },
  };
}

export type Scene = ReturnType<typeof createScene>;

import "@fontsource-variable/fraunces/full.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./tokens.css";
import "./style.css";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
// MapLibre 6 finds its worker next to its own module, which bundling breaks: hand Vite the worker to bundle instead.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import * as api from "./api";
import type { Layer, Place } from "./api";
import { LABEL_LAYERS, baseStyle } from "./basemap";
import { History } from "./layers";
import { Numeral } from "./numeral";
import { Ruler } from "./ruler";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------------------------------------------------------------- state
const state = {
  place: null as Place | null,
  years: [] as number[],
  year: null as number | null,
  layers: [] as Layer[], // maps for this year, best first
  chosen: null as Layer | null,
  cache: new Map<number, Promise<Layer[]>>(),
  labels: true,
};

// ---------------------------------------------------------------- map
maplibregl.setWorkerUrl(workerUrl);
const START = { center: [-73.9967, 40.7306] as [number, number], zoom: 13.2 };
const map = new maplibregl.Map({
  container: "map",
  style: baseStyle(),
  center: START.center,
  zoom: START.zoom,
  maxPitch: 0, // WarpedMapLayer doesn't support pitch
  dragRotate: false,
  attributionControl: { compact: true },
  canvasContextAttributes: { preserveDrawingBuffer: true }, // poster export reads the canvas back
});
map.touchZoomRotate.disableRotation();
map.on("error", (e) => console.error("map:", e.error?.message ?? e)); // tile/CORS failures must be visible, never silent
if (import.meta.env.DEV) Object.assign(window, { strataMap: map });
const history = new History(map, LABEL_LAYERS[0]);

// "load" waits for every initial tile, so one slow tile would hold the whole app hostage. Map additions only need the
// style parsed ("style.load"); nothing else waits for the map at all.
const styleReady = new Promise<void>((resolve) => (map.isStyleLoaded() ? resolve() : map.once("style.load", () => resolve())));
styleReady.then(() => {
  map.addSource("here", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("halo", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const error = token("--error"), survey = token("--survey"), night = token("--night");
  map.addLayer({ id: "halo-fill", type: "fill", source: "halo", paint: { "fill-color": error, "fill-opacity": 0.12 } });
  map.addLayer({ id: "halo-line", type: "line", source: "halo", paint: { "line-color": error, "line-opacity": 0.7, "line-width": 1 } });
  map.addLayer({ id: "pin", type: "circle", source: "here",
    paint: { "circle-radius": 5, "circle-color": survey, "circle-stroke-color": night, "circle-stroke-width": 2 } });
  drawPin();
});

/** A circle of `m` metres around the point, as a polygon: the honest size of "you are here" on this map. */
function circle(lon: number, lat: number, m: number) {
  const ring: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    ring.push([lon + (m * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (m * Math.sin(a)) / 110540]);
  }
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}

function drawPin() {
  const p = state.place, here = map.getSource("here") as GeoJSONSource | undefined, halo = map.getSource("halo") as GeoJSONSource | undefined;
  here?.setData({ type: "FeatureCollection", features: p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } }] : [] });
  const r = state.chosen?.rmse_m;
  halo?.setData({ type: "FeatureCollection", features: p && r ? [circle(p.lon, p.lat, r)] : [] });
}

// ---------------------------------------------------------------- arrival drift
// The drift is a CSS transform on the rendered canvas (style.css): the compositor moves pixels, MapLibre renders nothing
// and fetches no tiles. It stops for good at the first touch.
function startDrift() {
  for (const ev of ["pointerdown", "wheel", "keydown"] as const) addEventListener(ev, stopDrift, { once: true, capture: true });
}
const stopDrift = () => document.body.classList.add("still");

// ---------------------------------------------------------------- components
const numeral = new Numeral($("numeral"));
const ruler = new Ruler($("ruler"), (y) => selectYear(y), (y) => {
  const n = y === state.year ? state.layers.length : 0;
  const first = y === state.year ? state.chosen?.title : null;
  return [String(y), first, n > 1 ? `${n} maps` : null].filter(Boolean).join(", ");
});

const fmt = (n: number) => n.toLocaleString("en-US");
const announce = (s: string) => { $("announce").textContent = s; };

function renderCard() {
  const card = $("card"), L = state.chosen;
  card.hidden = !L;
  if (!L) return;
  const readouts = [
    L.scale_denom ? `1:${fmt(L.scale_denom)}` : null,
    L.rmse_m != null ? `<span class="err" title="Leave-one-out error of the alignment">±${fmt(Math.round(L.rmse_m))} m</span>` : null,
    L.method,
    api.licenseName(L.license),
    api.sourceName(L.source),
  ].filter(Boolean);
  const others = state.layers.length > 1
    ? `<div class="picker"><p class="label">${state.layers.length} maps from ${state.year}</p><ol>${state.layers.map((m) =>
        `<li><button type="button" data-id="${esc(m.id)}" aria-pressed="${m.id === L.id}"><span>${esc(m.title)}</span>${
          m.rmse_m != null ? `<i>±${Math.round(m.rmse_m)} m</i>` : ""}</button></li>`).join("")}</ol></div>`
    : "";
  card.innerHTML = `
    <p class="label">${L.year}${L.year !== state.year ? ` · nearest to ${state.year}` : ""}</p>
    <h2 class="title">${esc(L.title)}</h2>
    <p class="readouts">${readouts.join('<span class="sep">·</span>')}</p>
    ${L.source_url ? `<a class="source" href="${esc(L.source_url)}" target="_blank" rel="noopener">Source<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1h6v6M9 1 1.5 8.5"/></svg></a>` : ""}
    ${others}`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

$("card").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]")?.dataset.id;
  const L = state.layers.find((m) => m.id === id);
  if (L) choose(L);
});

// ---------------------------------------------------------------- data flow
const layersFor = (year: number) => {
  const p = state.place!;
  if (!state.cache.has(year)) state.cache.set(year, api.layers(p.lat, p.lon, year).then((ls) => {
    const same = ls.filter((l) => l.year === year);
    return same.length ? same : ls.slice(0, 1);
  }));
  return state.cache.get(year)!;
};

let pending = 0;
function selectYear(year: number) {
  state.year = year;
  numeral.set(year);
  ruler.set(year);
  writeUrl();
  clearTimeout(pending);
  pending = window.setTimeout(async () => {
    const ls = await layersFor(year).catch(() => []);
    if (state.year !== year) return; // the ruler has moved on
    state.layers = ls;
    const wanted = new URLSearchParams(location.search).get("map");
    choose(ls.find((l) => l.id === wanted) ?? ls[0] ?? null);
    announce(`${year}: ${state.chosen?.title ?? "no map"}`);
  }, 90);
}

async function choose(L: Layer | null) {
  state.chosen = L;
  renderCard();
  drawPin();
  ruler.set(state.year);
  // Neighbouring years start loading underneath, so the next step is a crossfade, not a wait.
  const i = state.years.indexOf(state.year ?? NaN);
  const near = [state.years[i - 1], state.years[i + 1]].filter((y): y is number => y !== undefined);
  await styleReady;
  history.show(L);
  const preload = (await Promise.all(near.map((y) => layersFor(y).catch(() => [])))).map((ls) => ls[0]).filter((l): l is Layer => !!l);
  if (state.chosen === L) history.show(L, preload);
}

function defaultYear(years: number[]) {
  // Land in the atlas era, where most maps are building-level: the year nearest 1900.
  return years.reduce((b, y) => (Math.abs(y - 1900) < Math.abs(b - 1900) ? y : b), years[0]!);
}

async function locate(q: string, opts: { lat?: number; lon?: number; year?: number; zoom?: number } = {}) {
  const status = $("search-status");
  status.textContent = "Looking…";
  let place: Place | null;
  try {
    place = opts.lat != null && opts.lon != null ? { label: q, lat: opts.lat, lon: opts.lon } : await api.geocode(q);
  } catch {
    place = null;
  }
  if (!place) { status.textContent = "No address found in New York City."; return; }
  stopDrift();
  state.place = place;
  state.cache.clear();
  $<HTMLInputElement>("q").value = place.label;
  document.body.classList.replace("arrival", "located");
  const center: [number, number] = [place.lon, place.lat];
  if (reduced()) map.jumpTo({ center, zoom: opts.zoom ?? 16.4 });
  else map.flyTo({ center, zoom: opts.zoom ?? 16.4, duration: 1200, easing: (t) => 1 - Math.pow(1 - t, 3) });
  drawPin();

  const years: number[] = await api.timeline(place.lat, place.lon).catch(() => []);
  state.years = years;
  status.textContent = "";
  $("caption").textContent = years.length
    ? `${years.length} ${years.length === 1 ? "year" : "years"} on record here · ${years[0]}–${years.at(-1)}`
    : "No map covers this spot yet.";
  if (!years.length) { state.year = null; numeral.set(null); ruler.setYears([], null); choose(null); writeUrl(); return; }
  const year = opts.year && years.includes(opts.year) ? opts.year : defaultYear(years);
  ruler.setYears(years, year);
  selectYear(year);
}

// ---------------------------------------------------------------- URL state: ?q=&lat=&lon=&z=&year=&map=&swipe=
function writeUrl() {
  if (!state.place) return;
  const u = new URLSearchParams({ q: state.place.label, lat: state.place.lat.toFixed(5), lon: state.place.lon.toFixed(5),
    z: map.getZoom().toFixed(1) });
  if (state.year) u.set("year", String(state.year));
  if (swipe.on) u.set("swipe", "1");
  history_.replaceState(null, "", `?${u}`);
}
const history_ = window.history;
map.on("moveend", () => state.place && writeUrl());

// ---------------------------------------------------------------- swipe compare (C): then │ today
const swipe = { on: false, x: 0.5 };
const swipeEl = Object.assign(document.createElement("div"), { className: "swipe", hidden: true });
swipeEl.innerHTML = `<div class="swipe-line"></div><button class="swipe-handle" type="button" aria-label="Swipe position: drag, or use the arrow keys"><span id="swipe-then"></span><i>│</i><span>${new Date().getFullYear()}</span></button>`;
document.querySelector("main")!.append(swipeEl);

// "Today" is a second, non-interactive map in our base style turned up so the modern city reads, clipped to the
// right of the line and following the main camera. Created on first use.
let today: maplibregl.Map | null = null;
function ensureToday() {
  if (today) return today;
  const el = Object.assign(document.createElement("div"), { className: "today", ariaHidden: "true" });
  $("map").after(el);
  today = new maplibregl.Map({ container: el, style: baseStyle(true), interactive: false, attributionControl: false,
    center: map.getCenter(), zoom: map.getZoom() });
  map.on("move", () => today!.jumpTo({ center: map.getCenter(), zoom: map.getZoom() }));
  return today;
}

function setSwipe(on: boolean) {
  swipe.on = on && !!state.chosen;
  if (swipe.on) ensureToday().resize();
  swipeEl.hidden = !swipe.on;
  document.body.classList.toggle("swiping", swipe.on);
  clipSwipe();
  writeUrl();
}
function clipSwipe() {
  $("swipe-then").textContent = String(state.year ?? "");
  swipeEl.style.setProperty("--x", `${swipe.x * 100}%`);
}
{
  const handle = swipeEl.querySelector<HTMLButtonElement>(".swipe-handle")!;
  const move = (clientX: number) => { swipe.x = Math.min(0.98, Math.max(0.02, clientX / innerWidth)); clipSwipe(); };
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const mv = (m: PointerEvent) => move(m.clientX);
    handle.addEventListener("pointermove", mv);
    handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", mv), { once: true });
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); e.stopPropagation();
    swipe.x = Math.min(0.98, Math.max(0.02, swipe.x + (e.key === "ArrowLeft" ? -0.05 : 0.05)));
    clipSwipe();
  });
}

// ---------------------------------------------------------------- poster export (P)
async function poster() {
  if (!state.place || !state.year) return;
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
  g.font = `400 ${size}px "Fraunces Variable"`;
  g.fillText(String(state.year), pad, c.height - pad - 34 * dpr);
  g.fillStyle = token("--vellum");
  g.font = `500 ${13 * dpr}px "IBM Plex Mono"`;
  g.fillText(state.place.label.toUpperCase(), pad, c.height - pad);
  g.fillStyle = token("--slate");
  g.font = `400 ${11 * dpr}px "IBM Plex Mono"`;
  const L = state.chosen;
  const credit = L ? `${L.title.slice(0, 80)} · ${api.sourceName(L.source)} · ${api.licenseName(L.license)}${L.rmse_m ? ` · ±${Math.round(L.rmse_m)} m` : ""}` : "";
  g.textAlign = "right";
  g.fillText(credit, c.width - pad, c.height - pad);
  g.fillText("STRATA · BASE © OPENSTREETMAP", c.width - pad, c.height - pad - 18 * dpr);
  const a = document.createElement("a");
  a.download = `strata-${state.year}-${state.place.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
  announce("Poster saved");
}

// ---------------------------------------------------------------- help dialog
let helpReturn: HTMLElement | null = null;
function setHelp(open: boolean) {
  const h = $("help");
  if (open) { helpReturn = document.activeElement as HTMLElement; h.hidden = false; $("help-close").focus(); }
  else if (!h.hidden) { h.hidden = true; helpReturn?.focus(); }
}
$("help-open").addEventListener("click", () => setHelp(true));
$("help-close").addEventListener("click", () => setHelp(false));
$("help").addEventListener("click", (e) => { if (e.target === $("help")) setHelp(false); });
$("help").addEventListener("keydown", (e) => { // keep Tab inside the dialog
  if (e.key === "Tab") { e.preventDefault(); $("help-close").focus(); }
});

// ---------------------------------------------------------------- keys
document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).matches("input, textarea");
  if (e.key === "Escape") { if (!$("help").hidden) setHelp(false); else if (swipe.on) setSwipe(false); else if (typing) (e.target as HTMLElement).blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !$("help").hidden) return;
  const k = e.key.toLowerCase();
  if (e.key === "/") { e.preventDefault(); $("q").focus(); $<HTMLInputElement>("q").select(); }
  else if (e.key === "?") setHelp(true);
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && state.year && !(e.target as HTMLElement).closest(".maplibregl-canvas")) {
    e.preventDefault();
    const y = ruler.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
    if (y && y !== state.year) selectYear(y);
  } else if (k === "b") {
    state.labels = !state.labels;
    for (const id of LABEL_LAYERS) map.setLayoutProperty(id, "visibility", state.labels ? "visible" : "none");
    announce(state.labels ? "Today's names shown" : "Today's names hidden");
  } else if (k === "o") {
    history.setOpacity(history.opacity + (e.shiftKey ? -0.1 : 0.1));
    announce(`Old map ${Math.round(history.opacity * 100)}% opaque`);
  } else if (k === "c") setSwipe(!swipe.on);
  else if (k === "p") poster();
});

// ---------------------------------------------------------------- search + samples
$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>("q").value.trim();
  if (q) { $("q").blur(); locate(q); }
});
document.querySelectorAll<HTMLButtonElement>(".samples button").forEach((b) =>
  b.addEventListener("click", () => locate(b.dataset.q!)));

// ---------------------------------------------------------------- boot
boot();
async function boot() {
  api.catalog().then((c) => {
    $("catalog").textContent = `${fmt(c.maps)} maps · ${c.years[0]}–${c.years.at(-1)}`;
    $("eyebrow").textContent = `New York City · ${c.years[0]} to ${c.years.at(-1)}`;
    if (document.body.classList.contains("arrival")) ruler.setYears(c.years, null, false);
  }).catch(() => {});
  const u = new URLSearchParams(location.search);
  const lat = Number(u.get("lat")), lon = Number(u.get("lon"));
  if (u.get("q") && Number.isFinite(lat) && Number.isFinite(lon) && u.get("lat")) {
    await locate(u.get("q")!, { lat, lon, year: Number(u.get("year")) || undefined, zoom: Number(u.get("z")) || undefined });
    if (u.get("swipe")) setTimeout(() => setSwipe(true), 400);
  } else startDrift();
}

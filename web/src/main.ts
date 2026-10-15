import "@fontsource-variable/fraunces/full.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import "./tokens.css";
import "./style.css";

import * as api from "./api";
import type { Layer, Place } from "./api";
import { CoreSample, type Lifespan } from "./core";
import { Numeral } from "./numeral";
import { Ruler } from "./ruler";
import type { Scene } from "./scene";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- state
const state = {
  place: null as Place | null,
  years: [] as number[],
  year: null as number | null,
  layers: [] as Layer[], // maps for this year, best first
  chosen: null as Layer | null,
  cache: new Map<number, Promise<Layer[]>>(),
  labels: true,
  zoom: 16.4,
  wantedMap: new URLSearchParams(location.search).get("map"), // a shared link can name the map, not just the year
  wantSwipe: new URLSearchParams(location.search).has("swipe"), // honoured once the first map is chosen
};

// ---------------------------------------------------------------- the map, on first intent
// The arrival screen is a still picture of the same view (style.css), so MapLibre (most of the JavaScript) loads only
// when someone reaches for the page, or when the URL already names a place.
let scene: Promise<Scene> | null = null;
let live: Scene | null = null;
const getScene = () => (scene ??= import("./scene").then(({ createScene }) => {
  live = createScene(() => { if (live) state.zoom = live.zoom(); if (state.place) writeUrl(); });
  return live;
}));
for (const ev of ["pointerdown", "pointermove", "focusin", "keydown", "touchstart", "wheel"] as const)
  addEventListener(ev, () => void getScene(), { once: true, passive: true, capture: true });

// The drift (style.css) is compositor-only; it stops for good at the first touch.
const stopDrift = () => document.body.classList.add("still");
for (const ev of ["pointerdown", "wheel", "keydown"] as const) addEventListener(ev, stopDrift, { once: true, capture: true });

// ---------------------------------------------------------------- core sample (I)
const core = new CoreSample($("core"), (span) => {
  // The first year with a map inside the place's lifespan, else the one nearest its start.
  const inside = state.years.find((y) => y >= span.start && y <= (span.end ?? 9999));
  const y = inside ?? state.years.reduce((b, c) => (Math.abs(c - span.start) < Math.abs(b - span.start) ? c : b), state.years[0]!);
  if (y !== undefined && y !== state.year) { ruler.set(y); selectYear(y); }
  announce(`${span.name}: showing ${y}`);
});
const coreOpen = () => $("core").hidden === false;
function setCore(open: boolean) {
  const panel = $("core"), btn = $("core-open");
  if (open === coreOpen()) return;
  panel.hidden = !open;
  document.body.classList.toggle("core-on", open);
  btn.setAttribute("aria-expanded", String(open));
  if (open) { core.setYear(state.year); $("core-title").focus(); } else btn.focus();
}
$("core-open").addEventListener("click", () => setCore(!coreOpen()));

// ---------------------------------------------------------------- components
const numeral = new Numeral($("numeral"));
const ruler = new Ruler($("ruler"), (y) => selectYear(y), (y) => {
  const n = y === state.year ? state.layers.length : 0;
  const first = y === state.year ? state.chosen?.title : null;
  return [String(y), first, n > 1 ? `${n} maps` : null].filter(Boolean).join(", ");
});

const fmt = (n: number) => n.toLocaleString("en-US");
const announce = (s: string) => { $("announce").textContent = s; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

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
  core.setYear(year);
  numeral.set(year);
  ruler.set(year);
  writeUrl();
  clearTimeout(pending);
  pending = window.setTimeout(async () => {
    const ls = await layersFor(year).catch(() => []);
    if (state.year !== year) return; // the ruler has moved on
    state.layers = ls;
    const wanted = ls.find((l) => l.id === state.wantedMap);
    state.wantedMap = null;
    choose(wanted ?? ls[0] ?? null);
    announce(`${year}: ${state.chosen?.title ?? "no map"}`);
  }, 90);
}

async function choose(L: Layer | null) {
  state.chosen = L;
  renderCard();
  if (state.wantSwipe && L) { state.wantSwipe = false; setSwipe(true); }
  writeUrl();
  ruler.set(state.year);
  const s = await getScene();
  s.setPin(state.place, L?.rmse_m ?? null);
  // Neighbouring years start loading underneath, so the next step is a crossfade, not a wait.
  const i = state.years.indexOf(state.year ?? NaN);
  const near = [state.years[i - 1], state.years[i + 1]].filter((y): y is number => y !== undefined);
  await s.show(L);
  const preload = (await Promise.all(near.map((y) => layersFor(y).catch(() => [])))).map((ls) => ls[0]).filter((l): l is Layer => !!l);
  if (state.chosen === L) await s.show(L, preload);
}

function defaultYear(years: number[]) {
  // Land in the atlas era, where most maps are building-level: the year nearest 1900.
  return years.reduce((b, y) => (Math.abs(y - 1900) < Math.abs(b - 1900) ? y : b), years[0]!);
}

async function locate(q: string, opts: { lat?: number; lon?: number; year?: number; zoom?: number } = {}) {
  const status = $("search-status");
  status.textContent = "Looking…";
  const sceneReady = getScene();
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
  state.zoom = opts.zoom ?? 16.4;
  $<HTMLInputElement>("q").value = place.label;
  document.body.classList.replace("arrival", "located");
  sceneReady.then((s) => { s.fly([place!.lon, place!.lat], state.zoom, reduced()); s.setPin(place, null); });

  api.history(place.lat, place.lon).then((spans) => core.set(spans as Lifespan[], place)).catch(() => core.set([], place));
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

// ---------------------------------------------------------------- URL state: ?q=&lat=&lon=&z=&year=&swipe=
function writeUrl() {
  if (!state.place) return;
  const u = new URLSearchParams({ q: state.place.label, lat: state.place.lat.toFixed(5), lon: state.place.lon.toFixed(5),
    z: state.zoom.toFixed(1) });
  if (state.year) u.set("year", String(state.year));
  if (state.chosen && state.chosen !== state.layers[0]) u.set("map", state.chosen.id);
  if (swipe.on) u.set("swipe", "1");
  window.history.replaceState(null, "", `?${u}`);
}

// ---------------------------------------------------------------- swipe compare (C): then │ today
const swipe = { on: false, x: 0.5 };
const swipeEl = Object.assign(document.createElement("div"), { className: "swipe", hidden: true });
swipeEl.innerHTML = `<div class="swipe-line"></div><button class="swipe-handle" type="button" aria-label="Swipe position: drag, or use the arrow keys"><span id="swipe-then"></span><i>│</i><span>${new Date().getFullYear()}</span></button>`;
document.querySelector("main")!.append(swipeEl);

async function setSwipe(on: boolean) {
  swipe.on = on && !!state.chosen;
  swipeEl.hidden = !swipe.on;
  document.body.classList.toggle("swiping", swipe.on); // first: the today map must be visible to measure its size
  if (swipe.on) (await getScene()).showToday();
  clipSwipe();
  writeUrl();
}
function clipSwipe() {
  $("swipe-then").textContent = String(state.year ?? "");
  document.body.style.setProperty("--x", `${swipe.x * 100}%`); // read by the line, the handle and the today map's clip
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
  const L = state.chosen;
  const credit = L ? `${L.title.slice(0, 80)} · ${api.sourceName(L.source)} · ${api.licenseName(L.license)}${L.rmse_m ? ` · ±${Math.round(L.rmse_m)} m` : ""}` : "";
  const a = document.createElement("a");
  a.download = `strata-${state.year}-${state.place.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  a.href = await (await getScene()).poster(state.year, state.place.label, credit);
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
  if (e.key === "Escape") { if (!$("help").hidden) setHelp(false); else if (coreOpen()) setCore(false); else if (swipe.on) setSwipe(false); else if (typing) (e.target as HTMLElement).blur(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !$("help").hidden) return;
  const k = e.key.toLowerCase();
  if (e.key === "/") { e.preventDefault(); $("q").focus(); $<HTMLInputElement>("q").select(); }
  else if (e.key === "?") setHelp(true);
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && state.year && !(e.target as HTMLElement).closest(".maplibregl-canvas")) {
    e.preventDefault();
    const y = ruler.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
    if (y && y !== state.year) selectYear(y);
  } else if (!state.place) return; // the rest act on a located map
  else if (k === "b") {
    state.labels = !state.labels;
    live?.setLabels(state.labels);
    announce(state.labels ? "Today's names shown" : "Today's names hidden");
  } else if (k === "o" && live) {
    live.setOpacity(live.opacity + (e.shiftKey ? -0.1 : 0.1));
    announce(`Old map ${Math.round(live.opacity * 100)}% opaque`);
  } else if (k === "c") setSwipe(!swipe.on);
  else if (k === "i") setCore(!coreOpen());
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
  if (u.get("q") && u.get("lat") && Number.isFinite(lat) && Number.isFinite(lon)) {
    await locate(u.get("q")!, { lat, lon, year: Number(u.get("year")) || undefined, zoom: Number(u.get("z")) || undefined });
  }
}

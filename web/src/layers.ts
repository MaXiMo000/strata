// Historical layers: one handle per map, kept in a small pool so the neighbouring years are already loading
// (opacity 0) when the ruler moves, and a change of year is a 400 ms crossfade, never a pop.
// Allmaps maps are warped here in the browser: the Allmaps tile server is blocked by NYPL/LOC (docs/ARCHITECTURE.md).
import type { Map as MlMap } from "maplibre-gl";
// Allmaps is most of the bundle and the arrival screen doesn't need it: loaded with the first warped map.
const allmaps = () => import("@allmaps/maplibre");
import type { Layer } from "./api";

interface Handle {
  layer: Layer;
  o: number; // current opacity, so a fade can start from wherever the last one stopped
  setOpacity(o: number): void;
  remove(): void;
}

const FADE_MS = 400;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class History {
  private pool = new Map<string, Handle>();
  private current: string | null = null;
  private fades = new Map<string, number>();
  private keep = new Set<string>();
  opacity = 0.9;

  constructor(private map: MlMap, private beforeId?: string) {}

  /** Make `layer` the visible map (crossfade), keep `preload` loading underneath, drop everything else. */
  show(layer: Layer | null, preload: Layer[] = []) {
    this.keep = new Set([layer, ...preload].filter(Boolean).map((l) => l!.id));
    for (const l of [layer, ...preload]) if (l && !this.pool.has(l.id)) this.pool.set(l.id, this.create(l));
    const previous = this.current;
    this.current = layer?.id ?? null;
    if (previous && previous !== this.current) this.fade(previous, 0);
    if (this.current) this.fade(this.current, this.opacity);
    // Drop maps that are neither shown nor preloaded once the fade has finished. `this.keep` is read when the timer
    // fires, so a newer show() wins.
    setTimeout(() => {
      for (const [id, h] of this.pool) if (!this.keep.has(id)) { h.remove(); this.pool.delete(id); }
    }, reduced() ? 0 : FADE_MS + 50);
  }

  setOpacity(o: number) {
    this.opacity = Math.min(1, Math.max(0.1, o));
    const h = this.current ? this.pool.get(this.current) : undefined;
    if (h) { h.o = this.opacity; h.setOpacity(this.opacity); }
  }

  private fade(id: string, to: number) {
    const h = this.pool.get(id);
    if (!h) return;
    cancelAnimationFrame(this.fades.get(id) ?? 0);
    const from = h.o;
    const set = (o: number) => { h.o = o; h.setOpacity(o); };
    if (reduced()) return set(to);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / FADE_MS);
      const e = 1 - Math.pow(1 - k, 3); // ease-out, matching cubic-bezier(.2,.7,.2,1) closely enough for opacity
      set(from + (to - from) * e);
      if (k < 1) this.fades.set(id, requestAnimationFrame(step));
    };
    this.fades.set(id, requestAnimationFrame(step));
  }

  private create(layer: Layer): Handle {
    const id = `history-${layer.id.replace(/[^a-z0-9]/gi, "-")}`;
    if (layer.georef_annotation) {
      // The handle exists at once; the layer joins the map when Allmaps has loaded, at whatever opacity the fade reached.
      let w: { setOpacity(o: number): void } | null = null, removed = false;
      const h: Handle = {
        layer, o: 0,
        setOpacity: (o) => w?.setOpacity(o),
        remove: () => { removed = true; if (this.map.getLayer(id)) this.map.removeLayer(id); },
      };
      allmaps().then(({ WarpedMapLayer }) => {
        if (removed) return;
        const layerObj = new WarpedMapLayer({ layerId: id });
        this.map.addLayer(layerObj, this.beforeId);
        layerObj.setOpacity(h.o);
        w = layerObj;
        return layerObj.addGeoreferenceAnnotationByUrl(layer.georef_annotation!);
      }).catch((e) => console.error("warped map", layer.id, e));
      return h;
    }
    this.map.addSource(id, { type: "raster", tiles: [layer.tile_url], tileSize: 256, attribution: "" });
    this.map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0 } } },
      this.beforeId);
    return {
      layer,
      o: 0,
      setOpacity: (o) => this.map.setPaintProperty(id, "raster-opacity", o),
      remove: () => { if (this.map.getLayer(id)) this.map.removeLayer(id); if (this.map.getSource(id)) this.map.removeSource(id); },
    };
  }
}

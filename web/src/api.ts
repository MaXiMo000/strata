export interface Layer {
  id: string;
  title: string;
  source: string;
  source_url: string | null;
  license: string;
  year: number;
  scale_denom: number | null;
  rmse_m: number | null;
  method: string | null;
  tile_url: string;
  georef_annotation: string | null;
}

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

const json = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
};

export const timeline = (lat: number, lon: number, signal?: AbortSignal) =>
  json<number[]>(`/api/timeline?lat=${lat}&lon=${lon}`, signal);

export const catalog = () => json<{ maps: number; years: number[] }>("/api/catalog");

export const layers = (lat: number, lon: number, year: number, signal?: AbortSignal) =>
  json<Layer[]>(`/api/layers?lat=${lat}&lon=${lon}&year=${year}&limit=8`, signal);

// Photon (komoot), biased to New York City: the pilot city. Fair use only; production self-hosts (DATA_SOURCES.md).
const NYC = "-74.26,40.49,-73.70,40.92";
export async function geocode(q: string, signal?: AbortSignal): Promise<Place | null> {
  const r = await json<{ features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }>(
    `https://photon.komoot.io/api/?limit=1&lang=en&bbox=${NYC}&q=${encodeURIComponent(q)}`, signal);
  const f = r.features[0];
  if (!f) return null;
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = [p.name && p.name !== street ? p.name : null, street || null, p.district ?? p.city].filter(Boolean).join(", ");
  const [lon, lat] = f.geometry.coordinates;
  return { label: label || q, lat, lon };
}

const SOURCES: Record<string, string> = {
  nypl: "NYPL", usgs: "USGS", "loc.gov": "LOC", "davidrumsey.com": "RUMSEY", "tile.loc.gov": "LOC",
  "digitalcommonwealth.org": "LEVENTHAL / BPL",
};
export const sourceName = (s: string) => SOURCES[s] ?? s.toUpperCase();

export const licenseName = (l: string) =>
  l === "public-domain" ? "PUBLIC DOMAIN"
    : l === "no-known-restrictions" ? "NO KNOWN RESTRICTIONS"
      : l.startsWith("CC-") ? l.replace(/^CC-/, "CC ").replace(/-(\d)/, " $1") // CC BY-NC-SA 3.0
        : l === "nypl-rights-unverified" ? "RIGHTS UNVERIFIED"
          : l.startsWith("http") ? "SEE RIGHTS" : l.toUpperCase();

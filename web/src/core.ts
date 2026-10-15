// The core sample: what stood near the address, drawn as lifespans in a vertical column of time (oldest at the top).
// Each place is a band in its own lane; a --survey hairline marks the year on the ruler, and the bands it crosses are
// lit. Clicking a place jumps the ruler to the first year with a map inside that place's lifespan.
import type { Place as Spot } from "./api";

export interface Lifespan {
  name: string;
  start: number;
  end: number | null;
  source: "wikidata" | "ohm";
  url: string;
}

const NOW = new Date().getFullYear();
const LABEL_H = 20; // px between label baselines
const LANE_W = 7;

/** Greedy interval colouring: each lifespan gets the first lane free when it starts. */
export function lanes(spans: Lifespan[]): number[] {
  const ends: number[] = [];
  return spans.map((s) => {
    let lane = ends.findIndex((e) => e < s.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = s.end ?? NOW;
    return lane;
  });
}

export class CoreSample {
  private spans: Lifespan[] = [];
  private lo = 1800;
  private body: HTMLElement;
  private line: HTMLElement;
  private year: number | null = null;

  constructor(private el: HTMLElement, private onJump: (span: Lifespan) => void) {
    el.innerHTML = `<header><h2 id="core-title" tabindex="-1">What stood here</h2><p class="label" id="core-sub"></p></header>
      <div class="core-body"><div class="core-ticks" aria-hidden="true"></div><ol class="core-list" aria-labelledby="core-title"></ol><div class="core-line" aria-hidden="true"><span></span></div></div>`;
    this.body = el.querySelector(".core-body")!;
    this.line = el.querySelector(".core-line")!;
    el.querySelector("ol")!.addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>("[data-i]")?.dataset.i;
      if (i !== undefined) this.onJump(this.spans[+i]!);
    });
    new ResizeObserver(() => this.draw()).observe(this.body);
  }

  set(spans: Lifespan[], here: Spot | null) {
    this.spans = spans;
    this.lo = Math.floor(Math.min(...spans.map((s) => s.start), NOW - 100) / 10) * 10;
    this.el.querySelector("#core-sub")!.textContent = spans.length
      ? `${spans.length} dated ${spans.length === 1 ? "place" : "places"} within 150 m${here ? ` of ${here.label.split(",")[0]}` : ""}`
      : "Nothing dated is recorded within 150 m yet.";
    this.draw();
  }

  setYear(year: number | null) {
    this.year = year;
    this.paintYear();
  }

  private y(year: number, h: number) {
    return ((year - this.lo) / (NOW - this.lo)) * h;
  }

  private draw() {
    const list = this.el.querySelector("ol")!;
    const h = Math.max(this.body.clientHeight - 8, 200);
    const lane = lanes(this.spans);
    const laneW = (Math.max(0, ...lane) + 1) * LANE_W;
    this.el.style.setProperty("--lanes", `${laneW}px`);
    // Decade ticks down the left edge, every 20 or 50 years depending on the room.
    const every = [20, 50, 100].find((s) => this.y(this.lo + s, h) >= 34) ?? 100;
    const ticks: string[] = [];
    for (let t = Math.ceil(this.lo / every) * every; t <= NOW; t += every)
      ticks.push(`<span class="core-tick" style="top:${this.y(t, h)}px">${t}</span>`);
    // Labels sit at their start year, pushed down so they never overlap; a leader joins label and band.
    let next = 0;
    const items = this.spans.map((s, i) => {
      const top = this.y(s.start, h), bottom = this.y(s.end ?? NOW, h);
      const labelY = Math.max(top, next);
      next = labelY + LABEL_H;
      const when = `${s.start}–${s.end ?? ""}`;
      return `<li class="core-item${s.end ? " ended" : ""}" data-start="${s.start}" data-end="${s.end ?? NOW}">
        <span class="core-band" style="top:${top}px;height:${Math.max(bottom - top, 2)}px;left:${lane[i]! * LANE_W}px" aria-hidden="true"></span>
        <span class="core-leader" style="top:${top}px;height:${labelY - top}px;left:${lane[i]! * LANE_W}px" aria-hidden="true"></span>
        <span class="core-tie" style="top:${labelY}px;left:${lane[i]! * LANE_W + 2}px;width:${laneW - lane[i]! * LANE_W + 6}px" aria-hidden="true"></span>
        <button type="button" data-i="${i}" style="top:${labelY}px" aria-label="${esc(s.name)}, ${s.start} to ${s.end ?? "today"}. Show its maps.">
          <span class="core-name">${esc(s.name)}</span><span class="core-when">${when}</span></button></li>`;
    });
    this.el.querySelector(".core-ticks")!.innerHTML = ticks.join("");
    list.innerHTML = items.join("");
    list.style.height = `${Math.max(h, next)}px`;
    this.paintYear();
  }

  private paintYear() {
    const h = Math.max(this.body.clientHeight - 8, 200);
    this.line.hidden = this.year === null;
    if (this.year === null) return;
    this.line.style.top = `${this.y(this.year, h)}px`;
    this.line.querySelector("span")!.textContent = String(this.year);
    for (const li of this.el.querySelectorAll<HTMLElement>(".core-item"))
      li.classList.toggle("lit", +li.dataset.start! <= this.year && this.year <= +li.dataset.end!);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

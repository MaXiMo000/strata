// The ruler: a surveyor's scale with notches only where history exists, so the density of notches *is* the coverage.
// Drag, click, or use the keys; it always lands on a year that has a map. An ARIA slider (docs/DESIGN.md "Keyboard").
export type Describe = (year: number) => string;

export class Ruler {
  private years: number[] = [];
  private year: number | null = null;
  private lo = 1800;
  private hi = 2030;
  private track: HTMLElement;
  private notches = new Map<number, HTMLElement>();

  constructor(private el: HTMLElement, private onInput: (year: number) => void, private describe: Describe = String) {
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", "Year");
    el.setAttribute("aria-orientation", "horizontal");
    this.track = Object.assign(document.createElement("div"), { className: "ruler-track" });
    el.append(this.track);
    el.addEventListener("pointerdown", (e) => this.drag(e));
    el.addEventListener("keydown", (e) => this.key(e));
    new ResizeObserver(() => this.draw()).observe(el);
  }

  /** interactive = false draws the catalog-wide coverage on the arrival screen: notches you can see, not use. */
  setYears(years: number[], year: number | null, interactive = true) {
    this.years = [...years].sort((a, b) => a - b);
    this.el.tabIndex = interactive && years.length ? 0 : -1;
    this.el.classList.toggle("passive", !interactive);
    this.el.setAttribute("aria-disabled", String(!interactive || !years.length));
    const first = this.years[0] ?? 1800, last = this.years.at(-1) ?? 2020;
    this.lo = Math.floor(first / 10) * 10 - 10;
    this.hi = Math.min(2030, Math.ceil((last + 1) / 10) * 10 + 10);
    this.el.setAttribute("aria-valuemin", String(first));
    this.el.setAttribute("aria-valuemax", String(last));
    this.draw();
    this.set(year);
  }

  set(year: number | null) {
    this.notches.get(this.year ?? NaN)?.classList.remove("now");
    this.year = year;
    if (year === null) return this.el.removeAttribute("aria-valuenow");
    this.notches.get(year)?.classList.add("now");
    this.el.style.setProperty("--now", `${this.x(year)}%`);
    this.el.setAttribute("aria-valuenow", String(year));
    this.el.setAttribute("aria-valuetext", this.describe(year));
  }

  /** Next available year in a direction (±1 = neighbour, ±10 = about a decade away, landing on a notch). */
  step(dir: number): number | null {
    if (this.year === null || !this.years.length) return null;
    const i = this.years.indexOf(this.year);
    if (Math.abs(dir) === 1) return this.years[Math.min(this.years.length - 1, Math.max(0, i + dir))] ?? null;
    const target = this.year + dir;
    const ahead = dir > 0 ? this.years.filter((y) => y > this.year! && y >= target) : this.years.filter((y) => y < this.year! && y <= target).reverse();
    return ahead[0] ?? (dir > 0 ? this.years.at(-1)! : this.years[0]!);
  }

  private x = (year: number) => ((year - this.lo) / (this.hi - this.lo)) * 100;

  private draw() {
    const width = this.el.clientWidth || 1;
    const decades = (this.hi - this.lo) / 10;
    // Label every decade if there's room for "1850" in mono at 10px (~40px), else every 20 or 50 years.
    const every = [10, 20, 50, 100].find((s) => (width / decades) * (s / 10) >= 52) ?? 100;
    const frag = document.createDocumentFragment();
    for (let y = this.lo; y <= this.hi; y += 5) {
      const t = document.createElement("span");
      t.className = y % 10 ? "tick" : "tick major";
      t.style.left = `${this.x(y)}%`;
      if (y % every === 0 && y > this.lo && y < this.hi) t.dataset.label = String(y);
      frag.append(t);
    }
    this.notches.clear();
    for (const y of this.years) {
      const n = document.createElement("span");
      n.className = "notch";
      n.style.left = `${this.x(y)}%`;
      this.notches.set(y, n);
      frag.append(n);
    }
    const cursor = Object.assign(document.createElement("span"), { className: "cursor" });
    frag.append(cursor);
    this.track.replaceChildren(frag);
    if (this.year !== null) this.set(this.year);
  }

  private nearest(clientX: number): number | null {
    const r = this.track.getBoundingClientRect();
    const y = this.lo + ((clientX - r.left) / r.width) * (this.hi - this.lo);
    return this.years.reduce<number | null>((best, c) => (best === null || Math.abs(c - y) < Math.abs(best - y) ? c : best), null);
  }

  private pick(year: number | null) {
    if (year !== null && year !== this.year) { this.set(year); this.onInput(year); }
  }

  private drag(e: PointerEvent) {
    if (this.el.tabIndex < 0) return;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add("dragging");
    this.pick(this.nearest(e.clientX));
    const move = (m: PointerEvent) => this.pick(this.nearest(m.clientX));
    const up = () => {
      this.el.classList.remove("dragging");
      this.el.removeEventListener("pointermove", move);
      this.el.removeEventListener("pointerup", up);
      this.el.removeEventListener("pointercancel", up);
    };
    this.el.addEventListener("pointermove", move);
    this.el.addEventListener("pointerup", up);
    this.el.addEventListener("pointercancel", up);
  }

  private key(e: KeyboardEvent) {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    let next: number | null = null;
    if (e.key in map) next = this.step(map[e.key]! * (e.shiftKey && Math.abs(map[e.key]!) === 1 ? 10 : 1));
    else if (e.key === "Home") next = this.years[0] ?? null;
    else if (e.key === "End") next = this.years.at(-1) ?? null;
    else return;
    e.preventDefault();
    e.stopPropagation(); // the global ←/→ handler would step twice
    this.pick(next);
  }
}

// The year, set huge in Fraunces. Changing year rolls each digit like an odometer (220 ms); only digits that change
// move. Decorative for assistive tech: the ruler's aria-valuetext carries the year.
export class Numeral {
  private reels: HTMLElement[] = [];
  private widths: number[] = []; // em width of each digit 0-9 in the numeral's face, measured once the font is in

  constructor(private el: HTMLElement) {
    el.setAttribute("aria-hidden", "true");
    // The face may not be requested yet (the numeral is hidden on arrival), so ask for it, then measure.
    document.fonts.load('300 100px "Fraunces Variable"').then(() => { this.widths = []; this.size(); });
  }

  private measure() {
    const probe = Object.assign(document.createElement("span"), { style: "position:absolute;visibility:hidden;white-space:pre" });
    this.el.append(probe);
    const em = parseFloat(getComputedStyle(this.el).fontSize);
    const w = [..."0123456789"].map((d) => { probe.textContent = d; return probe.getBoundingClientRect().width / em; });
    probe.remove();
    if (w.every((x) => x > 0)) this.widths = w; // zero while hidden: try again on the next set()
  }

  private size() {
    if (!this.widths.length) this.measure();
    if (!this.widths.length) return;
    this.reels.forEach((r) => (r.parentElement as HTMLElement).style.setProperty("--w", `${this.widths[+r.style.getPropertyValue("--d") || 0]}em`));
  }

  set(year: number | null) {
    const digits = year === null ? "" : String(year);
    if (this.reels.length !== digits.length) {
      this.el.replaceChildren(...[...digits].map(() => {
        const box = document.createElement("span");
        box.className = "digit";
        const reel = document.createElement("span");
        reel.className = "reel";
        reel.textContent = "0123456789".split("").join("\n");
        box.append(reel);
        return box;
      }));
      this.reels = [...this.el.querySelectorAll<HTMLElement>(".reel")];
      this.el.classList.add("no-roll"); // first paint jumps; rolling in from 0000 would read as a glitch
      requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove("no-roll")));
    }
    [...digits].forEach((d, i) => this.reels[i]!.style.setProperty("--d", d));
    this.size();
  }
}

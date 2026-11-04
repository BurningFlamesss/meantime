import { VIEWABILITY_THRESHOLD, MIN_VIEWABLE_MS } from "@meantime/shared";

/**
 * Cumulative active-viewport timer. Combines IntersectionObserver (>= 75% of
 * the element visible), document.visibilityState, and window focus into one
 * boolean "actively viewable" signal, and integrates its true-intervals with
 * performance.now() deltas. Pausing and resuming never lose accrued time.
 */
export class ViewportTimer {
  private accumulatedMs = 0;
  private lastTick: number | null = null;

  private inViewport = false;
  private pageVisible = true;
  private windowFocused = true;

  private observer: IntersectionObserver | null = null;
  private rafHandle: number | null = null;

  onEarned: (() => void) | null = null;
  private earnedFired = false;

  constructor(
    private readonly target: HTMLElement,
    readonly requiredDurationMs: number = MIN_VIEWABLE_MS,
  ) {}

  start(): void {
    this.pageVisible = document.visibilityState === "visible";
    this.windowFocused = document.hasFocus();

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.inViewport = !!entry && entry.intersectionRatio >= VIEWABILITY_THRESHOLD;
        this.tick();
      },
      { threshold: [0, VIEWABILITY_THRESHOLD, 1] },
    );
    this.observer.observe(this.target);

    document.addEventListener("visibilitychange", this.onVisibility, { passive: true });
    window.addEventListener("focus", this.onFocus, { passive: true });
    window.addEventListener("blur", this.onBlur, { passive: true });

    // rAF loop only while viewable, so an idle ad costs ~zero CPU.
    this.tick();
  }

  private onVisibility = () => {
    this.pageVisible = document.visibilityState === "visible";
    this.tick();
  };
  private onFocus = () => {
    this.windowFocused = true;
    this.tick();
  };
  private onBlur = () => {
    this.windowFocused = false;
    this.tick();
  };

  private get activelyViewable(): boolean {
    return this.inViewport && this.pageVisible && this.windowFocused;
  }

  private tick = () => {
    const now = performance.now();
    if (this.lastTick !== null && this.activelyViewable) {
      this.accumulatedMs += now - this.lastTick;
    }
    this.lastTick = this.activelyViewable ? now : null;

    if (!this.earnedFired && this.accumulatedMs >= this.requiredDurationMs) {
      this.earnedFired = true;
      this.onEarned?.();
    }

    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = this.activelyViewable ? requestAnimationFrame(this.tick) : null;
  };

  get cumulativeMs(): number {
    const now = performance.now();
    if (this.lastTick !== null && this.activelyViewable) {
      return this.accumulatedMs + (now - this.lastTick);
    }
    return this.accumulatedMs;
  }

  get earned(): boolean {
    return this.cumulativeMs >= this.requiredDurationMs;
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("blur", this.onBlur);
  }
}

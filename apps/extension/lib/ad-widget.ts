import type { PrefetchedAd } from "@meantime/shared";
import { MIN_VIEWABLE_MS } from "@meantime/shared";
import { ViewportTimer } from "./viewport-timer";
import { HoverTracker } from "./hover-tracker";

const CSS = `
:host { all: initial; color: CanvasText; }
* { box-sizing: border-box; }
.mt-wrap {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; margin: 6px 0;
  border: 1px solid rgba(127,127,127,.25); border-radius: 10px;
  background: rgba(127,127,127,.07);
  color: inherit; font-size: 13px; line-height: 1.4;
  max-width: 640px;
  isolation: isolate;
  transition: opacity .45s ease, transform .45s ease;
}
.mt-wrap.mt-fade { opacity: 0; transform: translateY(-4px); pointer-events: none; }
.mt-badge {
  flex: none; font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px;
  border: 1px solid rgba(127,127,127,.35); color: rgba(127,127,127,.9);
}
.mt-main { flex: 1 1 auto; min-width: 0; }
.mt-headline { font-weight: 600; font-size: 13px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-body { margin: 1px 0 0; opacity: .85; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mt-cta {
  flex: none; font-size: 12px; font-weight: 600; text-decoration: none;
  padding: 5px 10px; border-radius: 7px;
  border: 1px solid rgba(127,127,127,.4); color: inherit;
}
.mt-cta:hover { background: rgba(127,127,127,.15); }
.mt-controls { flex: none; display: flex; align-items: center; gap: 4px; position: relative; }
.mt-icon-btn {
  appearance: none; background: none; border: none; cursor: pointer;
  color: rgba(127,127,127,.8); font-size: 13px; padding: 3px 5px; border-radius: 5px; line-height: 1;
}
.mt-icon-btn:hover { background: rgba(127,127,127,.18); color: inherit; }
.mt-menu {
  position: absolute; top: 100%; right: 0; z-index: 10; margin-top: 4px;
  background: Canvas; color: CanvasText;
  border: 1px solid rgba(127,127,127,.35); border-radius: 8px;
  padding: 4px; min-width: 168px;
  box-shadow: 0 6px 24px rgba(0,0,0,.25);
}
.mt-menu button {
  display: block; width: 100%; text-align: left; border: none; background: none;
  color: inherit; font-size: 12px; padding: 6px 8px; border-radius: 5px; cursor: pointer;
}
.mt-menu button:hover { background: rgba(127,127,127,.15); }
.mt-progress { flex: none; width: 42px; height: 4px; border-radius: 2px; background: rgba(127,127,127,.25); overflow: hidden; }
.mt-progress > i { display: block; height: 100%; width: 0%; background: currentColor; opacity: .7; }
.mt-earned { flex: none; font-size: 11px; font-weight: 600; color: #2e9e5b; }
.mt-hidden { display: none; }
`;

export interface WidgetCallbacks {
  onDismiss: (reason: "dismissed" | "snoozed", snoozeMinutes?: number) => void;
  onEarned: () => void;
  onClickCta: () => void;
}

export class AdWidget {
  readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly wrap: HTMLDivElement;
  private readonly progressBar: HTMLElement;
  private readonly earnedBadge: HTMLSpanElement;
  private readonly menu: HTMLDivElement;
  readonly timer: ViewportTimer;
  readonly hover: HoverTracker;
  private disposed = false;

  constructor(
    readonly ad: PrefetchedAd,
    private readonly callbacks: WidgetCallbacks,
  ) {
    this.host = document.createElement("div");
    this.host.dataset.meantime = "ad";
    this.shadow = this.host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = CSS;

    this.wrap = document.createElement("div");
    this.wrap.className = "mt-wrap";
    this.wrap.setAttribute("role", "complementary");
    this.wrap.setAttribute("aria-label", "Sponsored message");

    const badge = document.createElement("span");
    badge.className = "mt-badge";
    badge.textContent = "Ad · MeanTime";

    const main = document.createElement("div");
    main.className = "mt-main";
    const headline = document.createElement("p");
    headline.className = "mt-headline";
    headline.textContent = ad.headline;
    const body = document.createElement("p");
    body.className = "mt-body";
    body.textContent = ad.bodyText;
    main.append(headline, body);

    const cta = document.createElement("a");
    cta.className = "mt-cta";
    cta.textContent = ad.ctaText;
    // Defense in depth for ads created before the API pinned http(s): a
    // `javascript:` or `data:` href must never be clickable.
    try {
      const url = new URL(ad.targetUrl);
      if (url.protocol === "http:" || url.protocol === "https:") cta.href = url.toString();
    } catch {
      // Leave the anchor without an href.
    }
    cta.target = "_blank";
    cta.rel = "noopener noreferrer sponsored";
    cta.addEventListener("click", () => this.callbacks.onClickCta());

    const progress = document.createElement("div");
    progress.className = "mt-progress";
    progress.setAttribute("aria-hidden", "true");
    this.progressBar = document.createElement("i");
    progress.append(this.progressBar);

    this.earnedBadge = document.createElement("span");
    this.earnedBadge.className = "mt-earned mt-hidden";
    this.earnedBadge.textContent = "✓ Earned";

    const controls = document.createElement("div");
    controls.className = "mt-controls";

    const snoozeBtn = document.createElement("button");
    snoozeBtn.className = "mt-icon-btn";
    snoozeBtn.title = "Pause MeanTime ads";
    snoozeBtn.setAttribute("aria-label", "Pause MeanTime ads");
    snoozeBtn.setAttribute("aria-haspopup", "menu");
    snoozeBtn.setAttribute("aria-expanded", "false");
    snoozeBtn.textContent = "⏸";

    const closeBtn = document.createElement("button");
    closeBtn.className = "mt-icon-btn";
    closeBtn.title = "Dismiss this ad";
    closeBtn.setAttribute("aria-label", "Dismiss this ad");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      this.callbacks.onDismiss("dismissed");
      this.destroy(false);
    });

    this.menu = document.createElement("div");
    this.menu.className = "mt-menu mt-hidden";
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", "Pause options");
    for (const [label, minutes] of [
      ["Pause for 10 min", 10],
      ["Pause for 15 min", 15],
      ["Pause for 1 hour", 60],
      ["Pause until I turn it back on", -1],
    ] as const) {
      const item = document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", () => {
        this.callbacks.onDismiss("snoozed", minutes);
        this.destroy(false);
      });
      this.menu.append(item);
    }

    const setMenuOpen = (open: boolean) => {
      this.menu.classList.toggle("mt-hidden", !open);
      snoozeBtn.setAttribute("aria-expanded", String(open));
    };
    snoozeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMenuOpen(this.menu.classList.contains("mt-hidden"));
    });
    // Close the menu on outside interaction / Escape without closing the ad.
    this.shadow.addEventListener(
      "pointerdown",
      (e) => {
        if (this.menu.classList.contains("mt-hidden")) return;
        const target = e.target as Node | null;
        if (target && !this.menu.contains(target) && target !== snoozeBtn) setMenuOpen(false);
      },
      { capture: true },
    );
    this.host.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape" && !this.menu.classList.contains("mt-hidden")) {
        setMenuOpen(false);
      }
    });

    controls.append(snoozeBtn, closeBtn, this.menu);
    this.wrap.append(badge, main, progress, this.earnedBadge, cta, controls);
    this.shadow.append(style, this.wrap);

    this.timer = new ViewportTimer(this.host);
    this.hover = new HoverTracker(this.host);
    this.timer.onEarned = () => {
      this.progressBar.style.width = "100%";
      this.earnedBadge.classList.remove("mt-hidden");
      this.callbacks.onEarned();
    };
  }

  mount(parent: HTMLElement): void {
    parent.append(this.host);
    this.timer.start();
    this.hover.start();
    this.animateProgress();
  }

  private animateProgress(): void {
    const step = () => {
      if (this.disposed || this.timer.earned) return;
      const pct = Math.min(100, (this.timer.cumulativeMs / MIN_VIEWABLE_MS) * 100);
      this.progressBar.style.width = `${pct.toFixed(1)}%`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Fade out and remove. `earnedFade` keeps the badge visible briefly. */
  destroy(earnedFade: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.timer.destroy();
    this.hover.destroy();
    const remove = () => this.host.remove();
    if (earnedFade) {
      this.wrap.classList.add("mt-fade");
      setTimeout(remove, 700);
    } else {
      remove();
    }
  }
}

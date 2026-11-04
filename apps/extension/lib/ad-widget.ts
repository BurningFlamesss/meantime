import type { PrefetchedAd } from "@meantime/shared";
import { MIN_VIEWABLE_MS } from "@meantime/shared";
import type { MountPosition, MountTarget } from "./adapters/base";
import { ViewportTimer } from "./viewport-timer";
import { HoverTracker } from "./hover-tracker";
import { PAUSE_UNTIL_RESTART } from "./storage";

const CSS = `
:host {
  all: initial;
  display: block;
  box-sizing: border-box;
}
* { box-sizing: border-box; }

.mt-wrap {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px; line-height: 1.4;
  box-sizing: border-box;
  isolation: isolate;
  transition: opacity .35s ease, transform .35s ease, background .2s ease, color .2s ease;
}

/* ---------------- ZERO LAYOUT SHIFT PLACEMENT RULES ---------------- */
:host([data-placement="under_prompt"]) {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 110px;
  max-width: calc(100% - 110px);
  z-index: 20;
  pointer-events: auto;
  display: flex;
  align-items: center;
}
:host([data-placement="under_prompt"]) .mt-wrap {
  margin: 0;
  width: 100%;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 2px 8px;
  gap: 8px;
}

:host([data-placement="above_composer"]) {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  z-index: 40;
  pointer-events: none;
  height: 0;
  overflow: visible;
}
:host([data-placement="above_composer"]) .mt-wrap {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0 auto 8px auto;
  max-width: 768px;
  width: calc(100% - 24px);
  pointer-events: auto;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

:host([data-placement="under_prompt"]) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 110px;
  max-width: calc(100% - 110px);
  z-index: 20;
  pointer-events: auto;
  display: flex;
  align-items: center;
}
:host([data-placement="under_prompt"]) .mt-wrap {
  margin: 0;
  width: 100%;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 2px 8px;
  gap: 8px;
}

:host([data-placement="ai_footer"]) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 175px;
  right: 0;
  max-width: calc(100% - 175px);
  z-index: 20;
  pointer-events: auto;
  display: flex;
  align-items: center;
}
:host([data-placement="ai_footer"]) .mt-wrap {
  margin: 0;
  width: 100%;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 2px 8px;
  gap: 8px;
}

:host([data-placement="thinking_indicator"]) {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 160px;
  right: 0;
  max-width: calc(100% - 160px);
  z-index: 20;
  pointer-events: auto;
  display: flex;
  align-items: center;
}
:host([data-placement="thinking_indicator"]) .mt-wrap {
  margin: 0;
  width: 100%;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 2px 8px;
  gap: 8px;
}

/* Compact layout for row-clipped placements (under_prompt, ai_footer, thinking_indicator) */
:host([data-placement="under_prompt"]) .mt-main,
:host([data-placement="ai_footer"]) .mt-main,
:host([data-placement="thinking_indicator"]) .mt-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
:host([data-placement="under_prompt"]) .mt-headline,
:host([data-placement="ai_footer"]) .mt-headline,
:host([data-placement="thinking_indicator"]) .mt-headline {
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 1 auto;
  margin: 0;
}
:host([data-placement="under_prompt"]) .mt-body,
:host([data-placement="ai_footer"]) .mt-body,
:host([data-placement="thinking_indicator"]) .mt-body {
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  opacity: 0.85;
  flex: 1 1 auto;
}
:host([data-placement="under_prompt"]) .mt-cta,
:host([data-placement="ai_footer"]) .mt-cta,
:host([data-placement="thinking_indicator"]) .mt-cta {
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1.2;
}
:host([data-placement="under_prompt"]) .mt-badge,
:host([data-placement="ai_footer"]) .mt-badge,
:host([data-placement="thinking_indicator"]) .mt-badge {
  font-size: 9px;
  padding: 2px 5px;
  letter-spacing: .04em;
}
:host([data-placement="under_prompt"]) .mt-progress,
:host([data-placement="ai_footer"]) .mt-progress,
:host([data-placement="thinking_indicator"]) .mt-progress {
  width: 32px;
  height: 4px;
}
:host([data-placement="under_prompt"]) .mt-menu,
:host([data-placement="ai_footer"]) .mt-menu,
:host([data-placement="thinking_indicator"]) .mt-menu {
  top: auto;
  bottom: 100%;
  margin-bottom: 6px;
  margin-top: 0;
}

@media (max-width: 640px) {
  :host([data-placement="under_prompt"]) .mt-body,
  :host([data-placement="ai_footer"]) .mt-body,
  :host([data-placement="thinking_indicator"]) .mt-body {
    display: none;
  }
}

.mt-wrap.mt-fade { opacity: 0; transform: translateY(-4px); pointer-events: none; }

.mt-badge {
  flex: none; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 5px;
}
.mt-main { flex: 1 1 auto; min-width: 0; }
.mt-headline { font-weight: 600; font-size: 13px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mt-body { margin: 2px 0 0; font-size: 12px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.mt-cta {
  flex: none; font-size: 12px; font-weight: 600; text-decoration: none;
  padding: 6px 12px; border-radius: 7px; cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.mt-controls { flex: none; display: flex; align-items: center; gap: 4px; position: relative; }
.mt-icon-btn {
  appearance: none; background: none; border: none; cursor: pointer;
  font-size: 14px; padding: 4px 6px; border-radius: 6px; line-height: 1;
  transition: background .15s ease, color .15s ease;
}
.mt-menu {
  position: absolute; top: 100%; right: 0; z-index: 50; margin-top: 4px;
  border-radius: 8px; padding: 4px; min-width: 172px;
}
.mt-menu button {
  display: block; width: 100%; text-align: left; border: none; background: none;
  font-size: 12px; padding: 6px 8px; border-radius: 5px; cursor: pointer;
}
.mt-progress { flex: none; width: 44px; height: 5px; border-radius: 3px; overflow: hidden; }
.mt-progress > i { display: block; height: 100%; width: 0%; transition: width .1s linear; }
.mt-earned { flex: none; font-size: 11px; font-weight: 700; }
.mt-hidden { display: none; }

/* ---------------- LIGHT THEME ---------------- */
:host([data-theme="light"]) .mt-wrap,
.mt-wrap.theme-light {
  background: #ffffff;
  color: #111827;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}
:host([data-theme="light"]) .mt-headline,
.theme-light .mt-headline { color: #111827; }
:host([data-theme="light"]) .mt-body,
.theme-light .mt-body { color: #374151; }
:host([data-theme="light"]) .mt-badge,
.theme-light .mt-badge {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  color: #4b5563;
}
:host([data-theme="light"]) .mt-cta,
.theme-light .mt-cta {
  background: #f9fafb;
  border: 1px solid #d1d5db;
  color: #111827;
}
:host([data-theme="light"]) .mt-cta:hover,
.theme-light .mt-cta:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}
:host([data-theme="light"]) .mt-icon-btn,
.theme-light .mt-icon-btn { color: #6b7280; }
:host([data-theme="light"]) .mt-icon-btn:hover,
.theme-light .mt-icon-btn:hover { background: #f3f4f6; color: #111827; }
:host([data-theme="light"]) .mt-menu,
.theme-light .mt-menu {
  background: #ffffff;
  color: #111827;
  border: 1px solid #e5e7eb;
  box-shadow: 0 10px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1);
}
:host([data-theme="light"]) .mt-menu button,
.theme-light .mt-menu button { color: #111827; }
:host([data-theme="light"]) .mt-menu button:hover,
.theme-light .mt-menu button:hover { background: #f3f4f6; }
:host([data-theme="light"]) .mt-progress,
.theme-light .mt-progress { background: #e5e7eb; }
:host([data-theme="light"]) .mt-progress > i,
.theme-light .mt-progress > i { background: #2563eb; }
:host([data-theme="light"]) .mt-earned,
.theme-light .mt-earned { color: #15803d; }

/* ---------------- DARK THEME ---------------- */
:host([data-theme="dark"]) .mt-wrap,
.mt-wrap.theme-dark {
  background: #202123;
  color: #ececf1;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
:host([data-theme="dark"]) .mt-headline,
.theme-dark .mt-headline { color: #ffffff; }
:host([data-theme="dark"]) .mt-body,
.theme-dark .mt-body { color: #d1d5db; }
:host([data-theme="dark"]) .mt-badge,
.theme-dark .mt-badge {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #e5e7eb;
}
:host([data-theme="dark"]) .mt-cta,
.theme-dark .mt-cta {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.24);
  color: #ffffff;
}
:host([data-theme="dark"]) .mt-cta:hover,
.theme-dark .mt-cta:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.4);
}
:host([data-theme="dark"]) .mt-icon-btn,
.theme-dark .mt-icon-btn { color: #9ca3af; }
:host([data-theme="dark"]) .mt-icon-btn:hover,
.theme-dark .mt-icon-btn:hover { background: rgba(255, 255, 255, 0.12); color: #ffffff; }
:host([data-theme="dark"]) .mt-menu,
.theme-dark .mt-menu {
  background: #28292f;
  color: #ececf1;
  border: 1px solid rgba(255, 255, 255, 0.18);
  box-shadow: 0 10px 25px -5px rgba(0,0,0,.5);
}
:host([data-theme="dark"]) .mt-menu button,
.theme-dark .mt-menu button { color: #ececf1; }
:host([data-theme="dark"]) .mt-menu button:hover,
.theme-dark .mt-menu button:hover { background: rgba(255, 255, 255, 0.1); }
:host([data-theme="dark"]) .mt-progress,
.theme-dark .mt-progress { background: rgba(255, 255, 255, 0.16); }
:host([data-theme="dark"]) .mt-progress > i,
.theme-dark .mt-progress > i { background: #3b82f6; }
:host([data-theme="dark"]) .mt-earned,
.theme-dark .mt-earned { color: #22c55e; }
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
  readonly requiredDurationMs: number;
  private isHovering = false;
  private isEarned = false;
  private pendingDestroyOnLeave = false;
  private disposed = false;

  constructor(
    readonly ad: PrefetchedAd,
    private readonly callbacks: WidgetCallbacks,
    initialTheme: "light" | "dark" = "dark",
  ) {
    this.requiredDurationMs = (ad.durationSec ?? 5) * 1_000;
    this.host = document.createElement("div");
    this.host.dataset.meantime = "ad";
    this.shadow = this.host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = CSS;

    this.wrap = document.createElement("div");
    this.wrap.className = "mt-wrap";
    this.wrap.setAttribute("role", "complementary");
    this.wrap.setAttribute("aria-label", "Sponsored message");
    this.setTheme(initialTheme);

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
      ["Pause for 5 min", 5],
      ["Pause for 10 min", 10],
      ["Pause for 15 min", 15],
      ["Pause for 1 hour", 60],
      ["Pause until browser restart", PAUSE_UNTIL_RESTART],
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

    this.timer = new ViewportTimer(this.host, this.requiredDurationMs);
    this.hover = new HoverTracker(this.host);

    // Track active hover so the ad doesn't disappear prematurely if user is reading it
    this.host.addEventListener("pointerenter", () => {
      this.isHovering = true;
    });
    this.host.addEventListener("pointerleave", () => {
      this.isHovering = false;
      if (this.pendingDestroyOnLeave) {
        this.pendingDestroyOnLeave = false;
        this.destroy(true);
      }
    });

    this.timer.onEarned = () => {
      this.isEarned = true;
      this.progressBar.style.width = "100%";
      this.earnedBadge.classList.remove("mt-hidden");
      this.callbacks.onEarned();
      if (this.isHovering) {
        // While user is hovering, keep the ad visible until pointer leaves
        this.pendingDestroyOnLeave = true;
      } else {
        this.destroy(true);
      }
    };
  }

  setTheme(theme: "light" | "dark"): void {
    this.host.dataset.theme = theme;
    this.wrap.dataset.theme = theme;
    this.wrap.classList.toggle("theme-dark", theme === "dark");
    this.wrap.classList.toggle("theme-light", theme === "light");
  }

  mount(target: HTMLElement | MountTarget, placement?: string, theme?: "light" | "dark"): void {
    if (placement) {
      this.host.dataset.placement = placement;
      this.wrap.dataset.placement = placement;
      this.applyHostStyles(placement);
    }
    if (theme) {
      this.setTheme(theme);
    }
    const el = "element" in target ? target.element : target;
    const pos: MountPosition = "position" in target ? target.position : "after";

    if (pos === "before") {
      el.before(this.host);
    } else if (pos === "append") {
      el.append(this.host);
    } else {
      el.after(this.host);
    }

    this.timer.start();
    this.hover.start();
    this.animateProgress();
  }

  private applyHostStyles(placement: string): void {
    if (placement === "above_composer") {
      this.host.style.position = "absolute";
      this.host.style.bottom = "100%";
      this.host.style.left = "0";
      this.host.style.right = "0";
      this.host.style.marginBottom = "8px";
      this.host.style.height = "0";
      this.host.style.minHeight = "0";
      this.host.style.lineHeight = "0";
      this.host.style.margin = "0";
      this.host.style.padding = "0";
      this.host.style.border = "none";
      this.host.style.overflow = "visible";
      this.host.style.pointerEvents = "none";
      this.host.style.zIndex = "40";
    } else if (placement === "under_prompt") {
      this.host.style.position = "absolute";
      this.host.style.top = "0";
      this.host.style.bottom = "0";
      this.host.style.left = "0";
      this.host.style.right = "110px";
      this.host.style.maxWidth = "calc(100% - 110px)";
      this.host.style.height = "32px";
      this.host.style.zIndex = "20";
      this.host.style.pointerEvents = "auto";
    } else if (placement === "ai_footer") {
      this.host.style.position = "absolute";
      this.host.style.top = "0";
      this.host.style.bottom = "0";
      this.host.style.left = "175px";
      this.host.style.right = "0";
      this.host.style.maxWidth = "calc(100% - 175px)";
      this.host.style.height = "32px";
      this.host.style.zIndex = "20";
      this.host.style.pointerEvents = "auto";
    } else if (placement === "thinking_indicator") {
      this.host.style.position = "absolute";
      this.host.style.top = "0";
      this.host.style.bottom = "0";
      this.host.style.left = "160px";
      this.host.style.right = "0";
      this.host.style.maxWidth = "calc(100% - 160px)";
      this.host.style.height = "32px";
      this.host.style.zIndex = "20";
      this.host.style.pointerEvents = "auto";
    }
  }

  reanchor(target: HTMLElement | MountTarget): void {
    if (this.disposed || !this.host) return;
    const el = "element" in target ? target.element : target;
    const pos: MountPosition = "position" in target ? target.position : "after";

    if (pos === "after" && el.nextElementSibling === this.host) return;
    if (pos === "before" && el.previousElementSibling === this.host) return;
    if (pos === "append" && el.lastElementChild === this.host) return;

    if (this.host.dataset.placement) {
      this.applyHostStyles(this.host.dataset.placement);
    }

    if (pos === "before") {
      el.before(this.host);
    } else if (pos === "append") {
      el.append(this.host);
    } else {
      el.after(this.host);
    }
  }

  private animateProgress(): void {
    const step = () => {
      if (this.disposed || this.timer.earned) return;
      const pct = Math.min(100, (this.timer.cumulativeMs / this.requiredDurationMs) * 100);
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
    const remove = () => {
      const parent = this.host.parentElement;
      this.host.remove();
      if (parent && parent.id === "meantime-above-composer-slot" && parent.childNodes.length === 0) {
        parent.remove();
      }
    };
    if (earnedFade) {
      this.wrap.classList.add("mt-fade");
      setTimeout(remove, 700);
    } else {
      remove();
    }
  }
}

import type { PrefetchedAd } from "@meantime/shared";
import { HOVER_HOLD_MAX_MS, MIN_VIEWABLE_MS } from "@meantime/shared";
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.35;
  box-sizing: border-box;
  isolation: isolate;
  transition: opacity .35s ease, transform .35s ease, background .2s ease, color .2s ease;
}

/* ---------------- PLACEMENT RULES ---------------- */

/* A. Above the prompt box. An absolute overlay on the composer container: the
   host takes no height, so the composer and page never move. */
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
  height: 42px;
  min-height: 42px;
  padding: 5px 12px;
  gap: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
}

/* B. In the thinking bubble. A normal flow row in the conversation, mounted
   immediately after the user's turn, exactly where the assistant's thinking
   indicator appears on every supported platform (including Angular Gemini).
   It is centred on the assistant content column and sizes to its content, so
   the paid copy gets the space that a badge/progress bar used to take. */
:host([data-placement="thinking_indicator"]) {
  display: block;
  width: 100%;
  position: relative;
  margin: 2px 0 12px;
  max-width: 100%;
  pointer-events: auto;
  z-index: 10;
}
:host([data-placement="thinking_indicator"]) .mt-wrap {
  position: relative;
  margin: 0 auto;
  max-width: 768px;
  width: calc(100% - 24px);
  height: auto;
  min-height: 46px;
  padding: 8px 14px;
  gap: 12px;
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
}

/* ---------------- CONTENT HIERARCHY & TYPOGRAPHY ---------------- */

/* Bottom-edge view progress: reads like the card's bottom border filling
   from left to right. It is absolutely positioned so it never takes space
   from the paid copy. */
.mt-progress {
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: 1px;
  height: 3px;
  border-radius: 0 0 9px 9px;
  overflow: hidden;
  pointer-events: none;
  background: rgba(127, 127, 127, 0.16);
}
.mt-progress-fill {
  display: block;
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: #2e9e5b;
  transition: width .1s linear, background .2s ease;
}

.mt-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  overflow: hidden;
}

.mt-headline {
  font-weight: 600;
  font-size: 13px;
  line-height: 1.25;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mt-body {
  margin: 0;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}

/* In the thinking bubble there is room for the full paid message: let the
   body wrap to two lines instead of truncating it into an ellipsis. */
:host([data-placement="thinking_indicator"]) .mt-body {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  white-space: normal;
}

.mt-cta {
  flex: none;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}

.mt-controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  position: relative;
}

.mt-icon-btn {
  appearance: none;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  padding: 4px;
  border-radius: 5px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s ease, color .15s ease;
}

.mt-menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 50;
  margin-top: 4px;
  border-radius: 8px;
  padding: 4px;
  min-width: 172px;
}

:host([data-placement="thinking_indicator"]) .mt-menu {
  top: auto;
  bottom: 100%;
  margin-bottom: 6px;
  margin-top: 0;
}

.mt-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.mt-wrap.mt-fade {
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
}

.mt-hidden {
  display: none;
}

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
.theme-light .mt-body { color: #4b5563; }
:host([data-theme="light"]) .mt-cta,
.theme-light .mt-cta {
  background: #111827;
  border: 1px solid #111827;
  color: #ffffff;
}
:host([data-theme="light"]) .mt-cta:hover,
.theme-light .mt-cta:hover {
  background: #374151;
  border-color: #374151;
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
:host([data-theme="dark"]) .mt-cta,
.theme-dark .mt-cta {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #ffffff;
}
:host([data-theme="dark"]) .mt-cta:hover,
.theme-dark .mt-cta:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.45);
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
`;

export interface WidgetCallbacks {
  onDismiss: (reason: "dismissed" | "snoozed" | "stream_started", snoozeMinutes?: number) => void;
  onEarned: () => void;
  onClickCta: () => void;
}

export class AdWidget {
  readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly wrap: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  readonly timer: ViewportTimer;
  readonly hover: HoverTracker;
  readonly requiredDurationMs: number;
  private hovering = false;
  private unhoverTimer: number | null = null;
  private holdCapTimer: number | null = null;
  private holdCallback: (() => void) | null = null;
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

    // 1. Content: Brand/Headline + Body
    const main = document.createElement("div");
    main.className = "mt-main";
    const headline = document.createElement("p");
    headline.className = "mt-headline";
    headline.textContent = ad.headline;
    const body = document.createElement("p");
    body.className = "mt-body";
    body.textContent = ad.bodyText;
    main.append(headline, body);

    // 2. Call-to-action button
    const cta = document.createElement("a");
    cta.className = "mt-cta";
    cta.textContent = ad.ctaText;
    // Defense in depth for URL protocols
    try {
      const url = new URL(ad.targetUrl);
      if (url.protocol === "http:" || url.protocol === "https:") cta.href = url.toString();
    } catch {
      // Leave the anchor without an href.
    }
    cta.target = "_blank";
    cta.rel = "noopener noreferrer sponsored";
    cta.addEventListener("click", () => this.callbacks.onClickCta());

    // 3. Necessary interaction controls (Pause + Dismiss)
    const controls = document.createElement("div");
    controls.className = "mt-controls";

    const snoozeBtn = document.createElement("button");
    snoozeBtn.type = "button"; // never submit the host site's composer form
    snoozeBtn.className = "mt-icon-btn";
    snoozeBtn.title = "Pause MeanTime ads";
    snoozeBtn.setAttribute("aria-label", "Pause MeanTime ads");
    snoozeBtn.setAttribute("aria-haspopup", "menu");
    snoozeBtn.setAttribute("aria-expanded", "false");
    snoozeBtn.textContent = "⏸";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mt-icon-btn";
    closeBtn.title = "Dismiss this ad";
    closeBtn.setAttribute("aria-label", "Dismiss this ad");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      this.cancelHoverHold();
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
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = label;
      item.addEventListener("click", () => {
        this.cancelHoverHold();
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

    // Bottom-border progress: the only non-content chrome, and it overlays
    // the card edge instead of consuming a content row.
    const progress = document.createElement("div");
    progress.className = "mt-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", "Ad view progress");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", "0");
    const progressFill = document.createElement("span");
    progressFill.className = "mt-progress-fill";
    progress.append(progressFill);

    this.wrap.append(main, cta, controls, progress);
    this.shadow.append(style, this.wrap);

    this.timer = new ViewportTimer(this.host, this.requiredDurationMs);
    this.timer.onProgress = (ratio) => {
      const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      progressFill.style.width = `${percent}%`;
      progress.setAttribute("aria-valuenow", String(percent));
    };
    this.hover = new HoverTracker(this.host);

    // A hover keeps the ad on screen (and keeps the viewport clock running),
    // so a reader is never yanked away mid-sentence. Transitions between the
    // widget's own children arrive as leave/enter pairs; the 250 ms grace
    // means moving from the headline to the CTA is still one hover.
    const onEnter = () => {
      if (this.unhoverTimer !== null) {
        clearTimeout(this.unhoverTimer);
        this.unhoverTimer = null;
      }
      this.hovering = true;
    };

    const onLeave = () => {
      if (this.unhoverTimer !== null) clearTimeout(this.unhoverTimer);
      this.unhoverTimer = window.setTimeout(() => {
        this.unhoverTimer = null;
        if (this.pointerStillOver()) return; // pointer came back / never truly left
        this.hovering = false;
        this.releaseHold();
      }, 250);
    };

    this.host.addEventListener("pointerenter", onEnter, { passive: true });
    this.host.addEventListener("mouseenter", onEnter, { passive: true });
    this.host.addEventListener("pointerleave", onLeave, { passive: true });
    this.host.addEventListener("mouseleave", onLeave, { passive: true });

    this.wrap.addEventListener("pointerenter", onEnter, { passive: true });
    this.wrap.addEventListener("mouseenter", onEnter, { passive: true });
    this.wrap.addEventListener("pointerleave", onLeave, { passive: true });
    this.wrap.addEventListener("mouseleave", onLeave, { passive: true });

    // The timer only reports that the required view was earned. The controller
    // decides whether to close now or hold the ad for an active hover.
    this.timer.onEarned = () => {
      this.callbacks.onEarned();
    };
  }

  get isUserHovering(): boolean {
    if (this.disposed) return false;
    if (this.pointerStillOver()) return true;
    return this.hovering;
  }

  private pointerStillOver(): boolean {
    if (!this.host.isConnected) return false;
    try {
      return this.host.matches(":hover") || this.wrap.matches(":hover");
    } catch {
      return false;
    }
  }

  /**
   * Hold an already-finished ad open for as long as the pointer rests on it,
   * then run `close`. Returns false when the widget is not hovered and the
   * caller should close immediately. The hold is capped by HOVER_HOLD_MAX_MS.
   */
  holdUntilPointerLeave(close: () => void): boolean {
    // Use the live pointer state, not the 250 ms leave-grace flag: a close that
    // arrives just as the pointer leaves must not wait for a leave event that
    // already happened.
    if (this.disposed || !this.pointerStillOver()) return false;
    this.holdCallback = close;
    if (this.holdCapTimer !== null) clearTimeout(this.holdCapTimer);
    this.holdCapTimer = window.setTimeout(() => {
      this.holdCapTimer = null;
      this.hovering = false;
      this.releaseHold();
    }, HOVER_HOLD_MAX_MS);
    return true;
  }

  private releaseHold(): void {
    if (this.holdCapTimer !== null) {
      clearTimeout(this.holdCapTimer);
      this.holdCapTimer = null;
    }
    const close = this.holdCallback;
    this.holdCallback = null;
    if (close) close();
  }

  private cancelHoverHold(): void {
    if (this.unhoverTimer !== null) {
      clearTimeout(this.unhoverTimer);
      this.unhoverTimer = null;
    }
    if (this.holdCapTimer !== null) {
      clearTimeout(this.holdCapTimer);
      this.holdCapTimer = null;
    }
    this.holdCallback = null;
    this.hovering = false;
  }

  setTheme(theme: "light" | "dark"): void {
    this.host.dataset.theme = theme;
    this.wrap.dataset.theme = theme;
    this.wrap.classList.toggle("theme-dark", theme === "dark");
    this.wrap.classList.toggle("theme-light", theme === "light");
  }

  mount(target: HTMLElement | MountTarget, placement?: string, theme?: "light" | "dark", platform?: string): void {
    if (placement) {
      this.host.dataset.placement = placement;
      this.wrap.dataset.placement = placement;
    }
    if (platform) {
      this.host.dataset.platform = platform;
      this.wrap.dataset.platform = platform;
    }
    if (placement) {
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
  }

  private applyHostStyles(placement: string): void {
    // Reset every inline property either placement may set, so re-anchoring
    // from one slot to the other never leaves a stale rule behind.
    this.host.style.cssText = "";
    if (placement === "above_composer") {
      this.host.style.position = "absolute";
      this.host.style.bottom = "100%";
      this.host.style.left = "0";
      this.host.style.right = "0";
      this.host.style.height = "0";
      this.host.style.overflow = "visible";
      this.host.style.pointerEvents = "none";
      this.host.style.zIndex = "40";
      return;
    }
    this.host.style.position = "relative";
    this.host.style.display = "block";
    this.host.style.width = "100%";
    this.host.style.maxWidth = "100%";
    this.host.style.margin = "6px 0";
    this.host.style.pointerEvents = "auto";
    this.host.style.zIndex = "10";
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

  /** Fade out and remove. Hover holds are handled by the controller before this. */
  destroy(earnedFade: boolean): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelHoverHold();
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

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

/* ---------------- ZERO LAYOUT SHIFT PLACEMENT RULES ---------------- */

/* A. Advertisement above prompt/input box */
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

/* B. Advertisement at the end of a user prompt */
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
  height: 42px;
  min-height: 42px;
  padding: 5px 12px;
  gap: 12px;
}

/* C. Advertisement near thinking indicator */
:host([data-placement="thinking_indicator"]) {
  display: block;
  width: 100%;
  position: relative;
  margin: 6px 0;
  pointer-events: auto;
  z-index: 10;
}
:host([data-placement="thinking_indicator"]) .mt-wrap {
  margin: 0 auto;
  max-width: 768px;
  width: calc(100% - 24px);
  height: 42px;
  min-height: 42px;
  padding: 5px 12px;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* D. Advertisement below AI response (inside action controls row) */
:host([data-placement="ai_footer"]) {
  display: inline-flex;
  align-items: center;
  position: relative;
  height: 32px;
  max-height: 32px;
  margin-left: 8px;
  flex: 0 1 auto;
  max-width: calc(100% - 170px);
  overflow: hidden;
  pointer-events: auto;
  z-index: 10;
  vertical-align: middle;
}
:host([data-placement="ai_footer"]) .mt-wrap {
  margin: 0;
  width: auto;
  max-width: 100%;
  height: 30px;
  min-height: 30px;
  padding: 2px 8px;
  gap: 8px;
}

/* Non-OpenAI / Gemini platform override: render flow-based container so it works in Angular layouts */
:host([data-platform="gemini"]:not([data-placement="above_composer"])) {
  position: relative !important;
  display: block !important;
  width: 100% !important;
  margin: 8px 0 !important;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  bottom: auto !important;
  max-width: 100% !important;
  z-index: 20 !important;
  pointer-events: auto !important;
}
:host([data-platform="gemini"]:not([data-placement="above_composer"])) .mt-wrap {
  position: relative !important;
  margin: 0 auto !important;
  max-width: 768px !important;
  width: calc(100% - 24px) !important;
  height: 42px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08) !important;
}

/* ---------------- CONTENT HIERARCHY & TYPOGRAPHY ---------------- */

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
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}

/* Inline single-line compact layout for AI footer action row */
:host([data-placement="ai_footer"]) .mt-main {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
:host([data-placement="ai_footer"]) .mt-headline {
  font-size: 12px;
  line-height: 1;
}
:host([data-placement="ai_footer"]) .mt-body {
  font-size: 11px;
  line-height: 1;
}

.mt-cta {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}

:host([data-placement="ai_footer"]) .mt-cta {
  padding: 3px 8px;
  font-size: 11px;
  line-height: 1.2;
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

:host([data-placement="under_prompt"]) .mt-menu,
:host([data-placement="ai_footer"]) .mt-menu,
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

@media (max-width: 640px) {
  .mt-body {
    display: none;
  }
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
  private isHovering = false;
  private unhoverTimer: number | null = null;
  private isEarned = false;
  private pendingDestroyOnLeave = false;
  private pendingEarnedFade = false;
  private pendingCloseReason: "dismissed" | "snoozed" | "stream_started" | "earned" | null = null;
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
      this.isHovering = false;
      this.pendingDestroyOnLeave = false;
      if (this.unhoverTimer !== null) {
        clearTimeout(this.unhoverTimer);
        this.unhoverTimer = null;
      }
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
        this.isHovering = false;
        this.pendingDestroyOnLeave = false;
        if (this.unhoverTimer !== null) {
          clearTimeout(this.unhoverTimer);
          this.unhoverTimer = null;
        }
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

    // Only core content + CTA + controls (no debugging, progress bar, or earned badge)
    this.wrap.append(main, cta, controls);
    this.shadow.append(style, this.wrap);

    this.timer = new ViewportTimer(this.host, this.requiredDurationMs);
    this.hover = new HoverTracker(this.host);

    // Track active hover: timer keeps ticking forward.
    // If user is hovering over the ad, the ad does NOT disappear until pointer leaves.
    const onEnter = () => {
      if (this.unhoverTimer !== null) {
        clearTimeout(this.unhoverTimer);
        this.unhoverTimer = null;
      }
      this.isHovering = true;
    };

    const onLeave = () => {
      if (this.unhoverTimer !== null) clearTimeout(this.unhoverTimer);
      this.unhoverTimer = window.setTimeout(() => {
        this.unhoverTimer = null;
        try {
          if (this.host.isConnected && (this.host.matches(":hover") || this.wrap.matches(":hover"))) {
            return; // Browser confirms pointer is still hovering!
          }
        } catch {
          // ignore
        }
        this.isHovering = false;
        if (this.pendingDestroyOnLeave) {
          this.pendingDestroyOnLeave = false;
          const reason = this.pendingCloseReason ?? (this.isEarned ? "earned" : "stream_started");
          this.pendingCloseReason = null;
          if (this.isEarned || reason === "earned") {
            this.callbacks.onEarned();
          } else {
            this.callbacks.onDismiss(reason);
          }
          this.destroy(this.pendingEarnedFade);
        }
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

    this.timer.onEarned = () => {
      this.isEarned = true;
      if (this.isUserHovering) {
        // While user is hovering, keep the ad visible for entire hover duration!
        this.pendingDestroyOnLeave = true;
        this.pendingEarnedFade = true;
        this.pendingCloseReason = "earned";
      } else {
        this.callbacks.onEarned();
        this.destroy(true);
      }
    };
  }

  get isUserHovering(): boolean {
    if (this.disposed) return false;
    try {
      if (this.host.isConnected && (this.host.matches(":hover") || this.wrap.matches(":hover"))) {
        return true;
      }
    } catch {
      // ignore
    }
    return this.isHovering;
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
      this.applyHostStyles(placement, platform);
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

  private applyHostStyles(placement: string, platform?: string): void {
    if (platform === "gemini") {
      this.host.style.position = "relative";
      this.host.style.display = "block";
      this.host.style.width = "100%";
      this.host.style.margin = "8px 0";
      this.host.style.left = "auto";
      this.host.style.right = "auto";
      this.host.style.top = "auto";
      this.host.style.bottom = "auto";
      this.host.style.maxWidth = "100%";
      this.host.style.pointerEvents = "auto";
      this.host.style.zIndex = "20";
      return;
    }
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
      this.host.style.height = "42px";
      this.host.style.zIndex = "20";
      this.host.style.pointerEvents = "auto";
    } else if (placement === "ai_footer") {
      this.host.style.position = "relative";
      this.host.style.display = "inline-flex";
      this.host.style.alignItems = "center";
      this.host.style.height = "32px";
      this.host.style.maxHeight = "32px";
      this.host.style.marginLeft = "8px";
      this.host.style.flex = "0 1 auto";
      this.host.style.maxWidth = "calc(100% - 170px)";
      this.host.style.overflow = "hidden";
      this.host.style.pointerEvents = "auto";
      this.host.style.zIndex = "10";
      this.host.style.verticalAlign = "middle";
    } else if (placement === "thinking_indicator") {
      this.host.style.position = "relative";
      this.host.style.display = "block";
      this.host.style.width = "100%";
      this.host.style.margin = "6px 0";
      this.host.style.pointerEvents = "auto";
      this.host.style.zIndex = "10";
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
      this.applyHostStyles(this.host.dataset.placement, this.host.dataset.platform);
    }

    if (pos === "before") {
      el.before(this.host);
    } else if (pos === "append") {
      el.append(this.host);
    } else {
      el.after(this.host);
    }
  }

  /** Fade out and remove. If user is currently hovering, defer until pointer leave. */
  destroy(earnedFade: boolean): void {
    if (this.disposed) return;
    if (this.isUserHovering) {
      this.pendingDestroyOnLeave = true;
      this.pendingEarnedFade = earnedFade;
      return;
    }
    this.disposed = true;
    if (this.unhoverTimer !== null) {
      clearTimeout(this.unhoverTimer);
      this.unhoverTimer = null;
    }
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

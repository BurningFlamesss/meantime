import {
  MIN_VIEWABLE_MS,
  PACING,
  type CloseReason,
  type ImpressionEvent,
  type Placement,
  type PohiSignals,
} from "@meantime/shared";
import { resolveAdapter } from "../lib/adapters/registry";
import type { PlatformAdapter } from "../lib/adapters/base";
import { AdWidget } from "../lib/ad-widget";
import { PohiCollector } from "../lib/pohi";
import {
  getSettings,
  PAUSE_UNTIL_RESTART,
  pauseState,
  saveSettings,
  STORAGE_KEYS,
  storageGet,
  uuidv4,
} from "../lib/storage";
import type { PromptCounter } from "../lib/storage";

/** Schema cap on a single event's timings. Anything longer is clamped. */
const MAX_EVENT_MS = 600_000;
/** An ad never occupies the tab for longer than this. */
const MAX_AD_LIFETIME_MS = 180_000;

export default defineContentScript({
  matches: [
    "*://chatgpt.com/*",
    "*://*.chatgpt.com/*",
    "*://chat.openai.com/*",
    "*://*.chat.openai.com/*",
    "*://gemini.google.com/*",
    "*://*.gemini.google.com/*",
    "*://grok.com/*",
    "*://*.grok.com/*",
    "*://x.com/i/grok*",
    "*://*.x.com/i/grok*",
    "*://claude.ai/*",
    "*://*.claude.ai/*",
    "*://deepseek.com/*",
    "*://*.deepseek.com/*",
    "*://chat.deepseek.com/*",
    "*://*.chat.deepseek.com/*",
  ],
  runAt: "document_idle",
  main() {
    const adapter = resolveAdapter(location.hostname, location.pathname);
    if (!adapter) return;
    console.info("[MeanTime] Active on", location.hostname);
    const controller = new MeanTimeController(adapter);
    controller.start();
  },
});

type TriggerSource = "enter_key" | "send_button";

class MeanTimeController {
  private readonly pohi = new PohiCollector();
  private pohiInput: HTMLElement | null = null;
  private listenersInstalled = false;
  private composerWaitObserver: MutationObserver | null = null;
  private composerWaitTimer: number | null = null;
  private inFlight = false;

  private activeWidget: AdWidget | null = null;
  private activeLease: {
    impressionId: string;
    submittedAt: number;
    displayMode: "wait_time_only" | "persist_until_5s";
    placement: Placement;
    pohiAtSubmit: Omit<PohiSignals, "aiMutationVerified">;
    closed: boolean;
  } | null = null;

  private generationObserver: MutationObserver | null = null;
  private generationCleanupTimer: number | null = null;
  private lifetimeTimer: number | null = null;
  private connectionTimer: number | null = null;
  private initialAiNode: HTMLElement | null = null;
  private firstOutputAt: number | null = null;

  constructor(private readonly adapter: PlatformAdapter) {}

  start(): void {
    this.tryAttach();
    this.installGlobalListeners();

    // SPA routers swap the composer without a reload. Re-resolve which input
    // PoHI is attached to, but never re-add the document-level listeners.
    const onNavigate = () => setTimeout(() => this.tryAttach(), 300);
    const origPush = history.pushState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      onNavigate();
      return ret;
    };
    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      onNavigate();
      return ret;
    };
    window.addEventListener("popstate", onNavigate, { passive: true });

    // Closing the tab must settle the impression rather than losing it.
    window.addEventListener("pagehide", () => this.finalize("navigated"), { passive: true });
  }

  /* ------------------------- trigger detection -------------------------- */

  /**
   * Global listeners are capture-only and passive: they observe the page and
   * never prevent or alter the AI site's own submit behavior. They stay valid
   * across SPA re-renders because they resolve the composer at event time.
   */
  private installGlobalListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;

    document.addEventListener(
      "keydown",
      (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key !== "Enter" || ke.shiftKey || ke.isComposing || ke.keyCode === 229) return;
        const input = this.currentInput();
        const target = ke.target;
        const isFromInput =
          target instanceof HTMLElement &&
          ((input && (target === input || input.contains(target))) ||
            target.matches(this.adapter.config.promptInputSelector) ||
            target.closest(this.adapter.config.promptInputSelector) !== null);
        if (!isFromInput) return;
        void this.onPromptSubmitted("enter_key");
      },
      { capture: true, passive: true },
    );

    document.addEventListener(
      "pointerdown",
      (e: Event) => {
        const target = e.target as Element | null;
        if (!target) return;
        const send = target.closest(this.adapter.config.sendButtonSelector);
        if (!send) return;
        void this.onPromptSubmitted("send_button");
      },
      { capture: true, passive: true },
    );
  }

  private currentInput(): HTMLElement | null {
    return document.querySelector<HTMLElement>(this.adapter.config.promptInputSelector);
  }

  private tryAttach(): void {
    const input = this.currentInput();
    if (!input) {
      this.waitForComposer();
      return;
    }
    this.stopWaitingForComposer();
    if (input !== this.pohiInput) {
      this.pohiInput = input;
      this.pohi.attach(input);
    }
  }

  private waitForComposer(): void {
    if (this.composerWaitObserver) return; // coalesce repeated nav events
    this.composerWaitObserver = new MutationObserver(() => {
      if (this.currentInput()) {
        this.stopWaitingForComposer();
        this.tryAttach();
      }
    });
    this.composerWaitObserver.observe(document.documentElement, { childList: true, subtree: true });
    this.composerWaitTimer = window.setTimeout(() => this.stopWaitingForComposer(), 15_000);
  }

  private stopWaitingForComposer(): void {
    this.composerWaitObserver?.disconnect();
    this.composerWaitObserver = null;
    if (this.composerWaitTimer !== null) {
      clearTimeout(this.composerWaitTimer);
      this.composerWaitTimer = null;
    }
  }

  /* ------------------------------ lifecycle ----------------------------- */

  private async onPromptSubmitted(source: TriggerSource): Promise<void> {
    if (this.inFlight || this.activeWidget) return; // one ad at a time
    console.info(`[MeanTime] Prompt detected (${source})`);
    // Snapshot both anchors synchronously, before any await: a fast model can
    // render a new answer while settings/storage is still being read, and a
    // baseline captured afterwards would treat that answer as pre-existing.
    const initialUserNode = this.adapter.findLatestUserMessage();
    const initialAiNode = this.adapter.findLatestAiMessage();
    this.inFlight = true;
    try {
      const settings = await getSettings();
      if (pauseState(settings).paused) {
        console.info("[MeanTime] Ads paused in settings");
        return;
      }

      // Layer-4 pacing, enforced client-side against the local counter; the
      // server re-checks authoritatively at prefetch/telemetry time.
      if (!(await this.pacingAllows())) {
        console.info("[MeanTime] Pacing threshold reached");
        return;
      }

      // Wait briefly for the target mount point to render.
      const viewport = performance.now();
      const mountPoint = await this.waitForMountPoint(
        settings.placement,
        initialUserNode,
        initialAiNode,
        2_500,
        viewport,
      );
      if (!mountPoint) {
        console.warn("[MeanTime] Could not find mount point for placement:", settings.placement);
        return;
      }

      const snap = this.pohi.snapshot(false);
      const pohiAtSubmit = {
        inputInteractionScore: snap.inputInteractionScore,
        keystrokeCount: snap.keystrokeCount,
        trustedPasteSeen: snap.trustedPasteSeen,
      };

      const ad = await chrome.runtime
        .sendMessage({ type: "take_ad", platform: this.adapter.platformId })
        .catch(() => null);
      if (!ad) {
        console.warn("[MeanTime] No ad available (cache empty, cooldown, or signed out)");
        return;
      }

      const impressionId = uuidv4();
      const submittedAt = Date.now();

      const widget = new AdWidget(ad, {
        onDismiss: (reason, snoozeMinutes) => {
          this.finalize(reason);
          if (reason === "snoozed" && typeof snoozeMinutes === "number") {
            const until =
              snoozeMinutes === PAUSE_UNTIL_RESTART
                ? PAUSE_UNTIL_RESTART
                : snoozeMinutes < 0
                  ? Number.MAX_SAFE_INTEGER
                  : Date.now() + snoozeMinutes * 60_000;
            void saveSettings({ snoozedUntil: until });
          }
        },
        onEarned: () => {
          console.info("[MeanTime] 5s view verified — impression earned!");
          this.finalize("earned");
        },
        onClickCta: () => {
          void chrome.runtime
            .sendMessage({ type: "ad_click", impressionId, leaseToken: ad.leaseToken })
            .catch(() => undefined);
        },
      });

      try {
        widget.mount(mountPoint, settings.placement);
        console.info("[MeanTime] Ad mounted successfully:", ad.headline, "at", settings.placement);
      } catch (err) {
        console.error("[MeanTime] Error mounting ad widget:", err);
        widget.destroy(false);
        void chrome.runtime.sendMessage({ type: "return_ad", ad }).catch(() => undefined);
        return;
      }

      this.activeWidget = widget;
      this.activeLease = {
        impressionId,
        submittedAt,
        displayMode: settings.displayMode,
        placement: settings.placement,
        pohiAtSubmit,
        closed: false,
      };

      this.pohi.reset();
      this.armWatchdogs(widget);
      this.watchGeneration(widget, initialAiNode);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Resolve the placement with a short poll.
   * - "above_composer": ready immediately above the prompt box.
   * - "under_prompt": waits for the newly sent user bubble.
   * - "thinking_indicator": waits for model reasoning / thinking block.
   * - "ai_footer": waits for the new AI message node.
   * Falls back safely to above the composer or under prompt (NEVER inside the prompt box).
   */
  private async waitForMountPoint(
    placement: Placement,
    initialUserNode: HTMLElement | null,
    initialAiNode: HTMLElement | null,
    timeoutMs: number,
    startedAt: number,
  ): Promise<HTMLElement | null> {
    // 1. "above_composer" is ready immediately (no waiting for response)
    if (placement === "above_composer") {
      const slot = this.adapter.getAboveComposerSlot();
      if (slot && slot.isConnected) return slot;
    }

    // 2. Poll for the specific placement target until timeout
    const deadline = startedAt + timeoutMs;
    while (performance.now() < deadline) {
      if (placement === "under_prompt") {
        const latest = this.adapter.findLatestUserMessage();
        const isNew = initialUserNode === null ? latest !== null : latest !== null && latest !== initialUserNode;
        if (isNew && latest) {
          const slot = this.adapter.getUserMessageActionSlot(latest);
          if (slot && slot.isConnected) return slot;
        }
      } else if (placement === "thinking_indicator") {
        const thinking = this.adapter.getThinkingSlot();
        if (thinking && thinking.isConnected) {
          return thinking;
        }
      } else if (placement === "ai_footer") {
        const latestAi = this.adapter.findLatestAiMessage();
        const isNewAi = initialAiNode === null ? latestAi !== null : latestAi !== null && latestAi !== initialAiNode;
        if (isNewAi && latestAi) {
          const slot = this.adapter.getAiMessageFooterSlot(latestAi);
          if (slot && slot.isConnected) return slot;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 3. Fallback resolution if specific target did not appear in time
    console.warn(`[MeanTime] Target for "${placement}" not found in ${timeoutMs}ms; using safe fallback`);
    return this.fallbackMount(placement);
  }

  private fallbackMount(requestedPlacement?: Placement): HTMLElement | null {
    // If thinking indicator or AI footer was requested but didn't appear (e.g. non-reasoning model or slow response),
    // try to anchor under the latest user prompt
    if (requestedPlacement === "thinking_indicator" || requestedPlacement === "ai_footer") {
      const user = this.adapter.findLatestUserMessage();
      if (user) {
        const slot = this.adapter.getUserMessageActionSlot(user);
        if (slot && slot.isConnected) return slot;
      }
    }

    // Clean above-composer slot outside the prompt form (NEVER inside form)
    const above = this.adapter.getAboveComposerSlot();
    if (above && above.isConnected) return above;

    const user = this.adapter.findLatestUserMessage();
    if (user) {
      const slot = this.adapter.getUserMessageActionSlot(user);
      if (slot && slot.isConnected) return slot;
    }

    return (
      document.querySelector<HTMLElement>(
        "main, [data-app-shell-focus-area='main'], div[data-thread-user-message-navigation-content], .thread-scroll-container",
      ) ?? document.body
    );
  }

  /* --------------------------- generation watch -------------------------- */

  private armWatchdogs(widget: AdWidget): void {
    this.lifetimeTimer = window.setTimeout(() => this.finalize("superseded"), MAX_AD_LIFETIME_MS);
    // If the host is removed by the site (route change, re-render), settle the
    // impression instead of holding the "one ad at a time" lock forever.
    this.connectionTimer = window.setInterval(() => {
      if (this.activeWidget && !widget.host.isConnected) this.finalize("navigated");
    }, 1_000);
  }

  /**
   * Scoped observer: attached to the response region, never document.body.
   * Output is considered new only when a different AI message node exists than
   * the one present at submit time, so a previous completed answer cannot end
   * the ad instantly.
   */
  private watchGeneration(widget: AdWidget, initialAiNode: HTMLElement | null): void {
    // The baseline is the answer that existed at submit, not at mount. If the
    // model already started replying while the ad was mounting, that new node
    // is detected on the first check and counts as the AI mutation.
    this.initialAiNode = initialAiNode;
    const root =
      initialAiNode?.parentElement ??
      document.querySelector<HTMLElement>(
        "main, [data-app-shell-focus-area='main'], div[data-thread-user-message-navigation-content], .thread-scroll-container",
      ) ??
      document.body;
    if (!root) return;

    const completeSelector = this.adapter.config.generationCompleteSelector;

    const check = () => {
      if (!this.activeWidget || this.activeLease?.closed) return;
      const latest = this.adapter.findLatestAiMessage();
      const isNew = this.initialAiNode === null ? latest !== null : latest !== null && latest !== this.initialAiNode;
      if (!isNew || !latest) return;

      const hasOutput = (latest.textContent?.trim().length ?? 0) > 0;
      if (hasOutput && this.firstOutputAt === null) {
        this.firstOutputAt = Date.now();
        this.onFirstAiOutput(widget);
      }
      const complete = latest.matches(completeSelector) || latest.querySelector(completeSelector) !== null;
      if (complete) {
        this.teardownObserver();
        // A fast model can finish before the 5 s threshold. In wait-time-only
        // mode that ends the ad (nothing is owed for a wait that never
        // happened). In persist mode the ad is already anchored and must stay
        // until it earns, otherwise a <5 s answer would silently pay nothing
        // while the user was still reading the ad.
        if (this.activeLease?.displayMode === "wait_time_only" && this.activeWidget) {
          this.finalize("stream_started");
        }
      }
    };

    this.generationObserver = new MutationObserver(check);
    this.generationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    this.generationCleanupTimer = window.setTimeout(() => this.teardownObserver(), MAX_AD_LIFETIME_MS);
    check();
  }

  private onFirstAiOutput(widget: AdWidget): void {
    if (!this.activeLease || this.activeLease.closed) return;

    if (this.activeLease.displayMode === "wait_time_only") {
      // Mode 1: instant removal the moment the AI starts streaming, even if
      // the answer arrives before 5 s. The event still reports the real
      // accrued time; the server rejects anything below the threshold.
      this.finalize("stream_started");
    } else if (widget.timer.cumulativeMs >= MIN_VIEWABLE_MS) {
      this.finalize("earned");
    }
    // Mode 2 with < 5 s accrued: keep the ad anchored; onEarned closes it.
  }

  private teardownObserver(): void {
    this.generationObserver?.disconnect();
    this.generationObserver = null;
    if (this.generationCleanupTimer !== null) {
      clearTimeout(this.generationCleanupTimer);
      this.generationCleanupTimer = null;
    }
  }

  private clearWatchdogs(): void {
    if (this.lifetimeTimer !== null) {
      clearTimeout(this.lifetimeTimer);
      this.lifetimeTimer = null;
    }
    if (this.connectionTimer !== null) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  /* ------------------------------ finalization --------------------------- */

  private finalize(reason: CloseReason): void {
    const widget = this.activeWidget;
    const lease = this.activeLease;
    if (!widget || !lease || lease.closed) return;
    lease.closed = true;
    this.teardownObserver();
    this.clearWatchdogs();

    const cumulativeVisibleMs = Math.min(MAX_EVENT_MS, Math.round(widget.timer.cumulativeMs));
    const earned = cumulativeVisibleMs >= MIN_VIEWABLE_MS;
    const aiWaitDurationMs = Math.min(
      MAX_EVENT_MS,
      Math.max(0, Math.round((this.firstOutputAt ?? Date.now()) - lease.submittedAt)),
    );
    const aiMutationVerified = this.firstOutputAt !== null;
    this.firstOutputAt = null;

    const hoverMs = Math.min(MAX_EVENT_MS, Math.round(widget.hover.hoverMs));
    const hoverIntentional = widget.hover.intentional;
    const leaseToken = widget.ad.leaseToken;

    widget.destroy(reason === "earned");
    this.activeWidget = null;
    this.activeLease = null;
    this.initialAiNode = null;

    const event: ImpressionEvent = {
      impressionId: lease.impressionId,
      leaseToken,
      platform: this.adapter.platformId,
      placement: lease.placement,
      displayMode: lease.displayMode,
      submittedAt: lease.submittedAt,
      aiWaitDurationMs,
      cumulativeVisibleMs,
      hoverMs,
      hoverIntentional,
      closedReason: reason,
      earned,
      pohi: {
        ...lease.pohiAtSubmit,
        aiMutationVerified,
      },
      promptsLastHour: 0, // filled in by the service worker from the counter
    };

    void chrome.runtime
      .sendMessage({ type: "queue_impression", event, campaignId: widget.ad.campaignId })
      .catch(() => undefined);
  }

  /* -------------------------------- pacing ------------------------------- */

  private async pacingAllows(): Promise<boolean> {
    const now = Date.now();
    let counter = await storageGet<PromptCounter>(STORAGE_KEYS.PROMPT_COUNTER, {
      windowStart: now,
      count: 0,
    });
    if (now - counter.windowStart > PACING.WINDOW_SECONDS * 1000) {
      counter = { windowStart: now, count: 0 };
    }
    counter.count++;
    await chrome.storage.local.set({ [STORAGE_KEYS.PROMPT_COUNTER]: counter });

    if (counter.count <= PACING.TIER1_MAX_PER_HOUR) return true;
    if (counter.count <= PACING.TIER2_MAX_PER_HOUR) {
      return counter.count % PACING.TIER2_PROMPT_DIVISOR === 0;
    }
    return false; // Tier 3: silent cap for the rest of the window.
  }
}

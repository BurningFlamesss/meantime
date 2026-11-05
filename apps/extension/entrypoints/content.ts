import {
  MIN_VIEWABLE_MS,
  PACING,
  type CloseReason,
  type ImpressionEvent,
  type Placement,
  type PohiSignals,
  type PrefetchedAd,
} from "@meantime/shared";
import { resolveAdapter } from "../lib/adapters/registry";
import type { MountTarget, PlatformAdapter } from "../lib/adapters/base";
import { AdWidget } from "../lib/ad-widget";
import { observeSiteTheme, resolveWidgetTheme } from "../lib/theme";
import { PohiCollector } from "../lib/pohi";
import {
  getCachedSettings,
  getSettings,
  PAUSE_UNTIL_RESTART,
  pauseState,
  saveSettings,
  STORAGE_KEYS,
  storageGet,
  storageSet,
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
    "*://claude.ai/*",
    "*://*.claude.ai/*",
    "*://grok.com/*",
    "*://*.grok.com/*",
    "*://x.com/i/grok*",
    "*://*.x.com/i/grok*",
    "*://chat.deepseek.com/*",
    "*://*.chat.deepseek.com/*",
    "*://deepseek.com/*",
    "*://*.deepseek.com/*",
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
  private preSubmitUserMsgKey: string | HTMLElement | null = null;
  private reanchorObserver: MutationObserver | null = null;
  private themeCleanup: (() => void) | null = null;

  private activeWidget: AdWidget | null = null;
  private activeLease: {
    impressionId: string;
    submittedAt: number;
    displayMode: "wait_time_only" | "persist_until_5s";
    placement: Placement;
    pohiAtSubmit: Omit<PohiSignals, "aiMutationVerified">;
    closed: boolean;
    /** Reason requested while the pointer held the ad open. */
    pendingClose: CloseReason | null;
  } | null = null;

  private generationObserver: MutationObserver | null = null;
  private generationInterval: number | null = null;
  private generationCleanupTimer: number | null = null;
  private lifetimeTimer: number | null = null;
  private connectionTimer: number | null = null;
  private initialAiNode: HTMLElement | null = null;
  /** Trimmed text length of the latest AI message at submit, to detect growth on a reused node. */
  private initialAiTextLen = 0;
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
            target.closest(this.adapter.config.promptInputSelector) !== null ||
            (target.isContentEditable && target.closest("rich-textarea, .input-area, [contenteditable='true'], form, main") !== null));
        if (!isFromInput) return;
        void this.onPromptSubmitted("enter_key");
      },
      { capture: true, passive: true },
    );

    const onSendTrigger = (e: Event) => {
      const target = e.target as Element | null;
      if (!target) return;
      const btn = target.closest("button, [role='button']");
      if (!btn) return;
      const aria = (btn.getAttribute("aria-label") ?? "").toLowerCase();
      const isSend =
        btn.matches(this.adapter.config.sendButtonSelector) ||
        aria.includes("send") ||
        aria.includes("submit") ||
        btn.classList.contains("send-button") ||
        btn.closest(".send-button-container") !== null ||
        btn.querySelector("mat-icon[fonticon='send'], mat-icon:not(:empty)")?.textContent?.trim().toLowerCase() === "send" ||
        (btn.closest("rich-textarea, .input-area-container, .bottom-container, .input-area") !== null &&
          (aria.includes("prompt") || aria.includes("message") || btn.classList.contains("send-button")));
      if (!isSend) return;
      void this.onPromptSubmitted("send_button");
    };

    document.addEventListener("pointerdown", onSendTrigger, { capture: true, passive: true });
    document.addEventListener("click", onSendTrigger, { capture: true, passive: true });
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
    // Focus gating: only activate when the matching site has focus
    if (document.hidden) {
      console.info("[MeanTime] Tab not focused, skipping ad");
      return;
    }
    if (this.inFlight || this.activeWidget) return; // one ad at a time
    console.info(`[MeanTime] Prompt detected (${source})`);

    const settings = getCachedSettings();
    if (pauseState(settings).paused) {
      console.info("[MeanTime] Ads paused in settings");
      return;
    }

    // Snapshot anchors and PoHI synchronously at the submit turn
    const initialUserNode = this.adapter.findLatestUserMessage();
    this.preSubmitUserMsgKey = this.adapter.getMessageKey(initialUserNode);
    const initialAiNode = this.adapter.findLatestAiMessage();
    this.initialAiTextLen = initialAiNode?.textContent?.trim().length ?? 0;

    const snap = this.pohi.snapshot(false);
    const pohiAtSubmit = {
      inputInteractionScore: snap.inputInteractionScore,
      keystrokeCount: snap.keystrokeCount,
      trustedPasteSeen: snap.trustedPasteSeen,
    };

    this.inFlight = true;

    // Prompt volume is recorded for telemetry/fraud audits, but the pacing
    // decision uses mounted ads only. Ordinary AI use therefore never spends
    // ad capacity or silences ads it did not actually show.
    const pacingPromise = this.recordPrompt().then(() => this.pacingAllows());
    // Determine which ad take strategy to use based on display mode
    const requestAd = (): Promise<PrefetchedAd | null> => {
      if (settings.displayMode === "wait_time_only") {
        // For strict wait-time mode, use deterministic serve-history rotation
        return chrome.runtime
          .sendMessage({ type: "take_ad_rotated", platform: this.adapter.platformId, maxDurationSec: settings.maxAdDurationSec })
          .catch(() => null) as Promise<PrefetchedAd | null>;
      } else {
        // For persist-until-5s mode, use the original FIFO approach
        return chrome.runtime
          .sendMessage({ type: "take_ad", platform: this.adapter.platformId, maxDurationSec: settings.maxAdDurationSec })
          .catch(() => null) as Promise<PrefetchedAd | null>;
      }
    };
    let adPromise: Promise<PrefetchedAd | null> | null = null;
    // A lease taken from the cache is single-use. If this prompt never mounts
    // an ad, put it back instead of silently burning it.
    const releaseUnusedAd = () => {
      const pending = adPromise;
      if (!pending) return;
      void pending
        .then((ad) => {
          if (ad) void chrome.runtime.sendMessage({ type: "return_ad", ad }).catch(() => undefined);
        })
        .catch(() => undefined);
    };

    try {
      const allowed = await pacingPromise;
      if (!allowed) {
        console.info("[MeanTime] Pacing threshold reached");
        return;
      }

      // Take the ad in parallel with slot resolution so mount stays instant.
      adPromise = requestAd();

      // Fast mount resolution via MutationObserver (zero-latency DOM attachment)
      const resolved = await this.waitForMountPoint(settings.placement);
      if (!resolved || !resolved.target) {
        console.warn("[MeanTime] Could not find mount point for placement:", settings.placement);
        releaseUnusedAd();
        return;
      }
      const mountPoint = resolved.target;
      const actualPlacement = resolved.placement;

      const ad = await adPromise;
      if (!ad) {
        console.warn("[MeanTime] No ad available (cache empty, cooldown, or signed out)");
        return;
      }

      const impressionId = uuidv4();
      const submittedAt = Date.now();
      const resolvedTheme = resolveWidgetTheme(settings.theme);

      const widget = new AdWidget(
        ad,
        {
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
            console.info(`[MeanTime] ${(ad.durationSec ?? 5)}s view verified and still visible – impression earned!`);
            this.finalize("earned");
          },
          onClickCta: () => {
            void chrome.runtime
              .sendMessage({ type: "ad_click", impressionId, leaseToken: ad.leaseToken })
              .catch(() => undefined);
          },
        },
        resolvedTheme,
      );

      try {
        widget.mount(mountPoint, actualPlacement, resolvedTheme, this.adapter.platformId);
        void this.bumpAdCounter().catch(() => undefined);
        console.info(
          "[MeanTime] Ad mounted successfully:",
          ad.headline,
          "at",
          actualPlacement,
          `(${resolvedTheme} theme)`,
        );
      } catch (err) {
        console.error("[MeanTime] Error mounting ad widget:", err);
        widget.destroy(false);
        void chrome.runtime.sendMessage({ type: "return_ad", ad }).catch(() => undefined);
        return;
      }

      this.themeCleanup = observeSiteTheme(settings.theme, (theme) => {
        widget.setTheme(theme);
      });

      this.activeWidget = widget;
      this.activeLease = {
        impressionId,
        submittedAt,
        displayMode: settings.displayMode,
        placement: actualPlacement,
        pohiAtSubmit,
        closed: false,
        pendingClose: null,
      };

      this.pohi.reset();
      this.watchReanchor(actualPlacement);
      this.armWatchdogs(widget);
      this.watchGeneration(widget, initialAiNode);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Resolve one of the two slots with a scoped MutationObserver (no document
   * polling while idle).
   * - "above_composer": ready immediately above the prompt box.
   * - "thinking_indicator": waits for the new user turn, then mounts after it,
   *   exactly where the assistant's thinking bubble will render.
   * If the chosen slot cannot be found the other slot is used rather than
   * leaving a broken container behind.
   */
  private waitForMountPoint(
    placement: Placement,
  ): Promise<{ target: MountTarget | HTMLElement | null; placement: Placement }> {
    if (placement === "above_composer") {
      const slot = this.adapter.getAboveComposerSlot();
      if (slot) return Promise.resolve({ target: slot, placement: "above_composer" });
    }

    return new Promise<{ target: MountTarget | HTMLElement | null; placement: Placement }>((resolve) => {
      let resolved = false;
      let observer: MutationObserver | null = null;
      let timeoutTimer: number | null = null;

      const finish = (result: { target: MountTarget | HTMLElement | null; placement: Placement }) => {
        if (resolved) return;
        resolved = true;
        observer?.disconnect();
        observer = null;
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        resolve(result);
      };

      const checkNow = () => {
        if (placement === "above_composer") {
          const slot = this.adapter.getAboveComposerSlot();
          if (slot) {
            finish({ target: slot, placement: "above_composer" });
            return true;
          }
          return false;
        }

        const latest = this.adapter.findLatestUserMessage();
        if (!latest) return false;
        const key = this.adapter.getMessageKey(latest);
        const isNew =
          this.preSubmitUserMsgKey === null ? true : key !== this.preSubmitUserMsgKey;
        if (!isNew) return false;
        const slot = this.adapter.getThinkingSlot();
        if (!slot) return false;
        finish({ target: slot, placement: "thinking_indicator" });
        return true;
      };

      if (checkNow()) return;

      // Scoped to the thread region where possible; document.body only as a
      // fallback while a SPA has not rendered its main container yet.
      const region =
        document.querySelector<HTMLElement>(
          "main, [data-app-shell-focus-area='main'], div[data-thread-user-message-navigation-content], .thread-scroll-container",
        ) ?? document.body;
      observer = new MutationObserver(() => {
        checkNow();
      });
      observer.observe(region, { childList: true, subtree: true });

      timeoutTimer = window.setTimeout(() => {
        console.warn(`[MeanTime] Slot "${placement}" not ready; using safe fallback`);
        finish(this.fallbackMount());
      }, 3_000);
    });
  }

  private fallbackMount(): { target: MountTarget | HTMLElement | null; placement: Placement } {
    const thinking = this.adapter.getThinkingSlot();
    if (thinking) return { target: thinking, placement: "thinking_indicator" };

    const above = this.adapter.getAboveComposerSlot();
    if (above) return { target: above, placement: "above_composer" };

    const main =
      document.querySelector<HTMLElement>(
        "main, [data-app-shell-focus-area='main'], div[data-thread-user-message-navigation-content], .thread-scroll-container",
      ) ?? document.body;
    return { target: main, placement: "thinking_indicator" };
  }

  /**
   * Reassert anchor on SPA thread rebuilds or navigation (e.g. ChatGPT / to /c/<id>).
   */
  private watchReanchor(placement: Placement): void {
    this.reanchorObserver?.disconnect();

    // Focus gating for reanchor: only watch when the site has focus
    const shouldWatch = () => !document.hidden;

    this.reanchorObserver = new MutationObserver(() => {
      if (!this.activeWidget || this.activeLease?.closed) return;
      if (!shouldWatch()) return;
      if (placement === "above_composer") {
        const slot = this.adapter.getAboveComposerSlot();
        if (slot) this.activeWidget.reanchor(slot);
        return;
      }
      const latest = this.adapter.findLatestUserMessage();
      if (!latest) return;
      const slot = this.adapter.getThinkingSlot();
      if (slot) this.activeWidget.reanchor(slot);
    });

    // Only observe when the site has focus
    if (shouldWatch()) {
      this.reanchorObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  private stopWatchingReanchor(): void {
    this.reanchorObserver?.disconnect();
    this.reanchorObserver = null;
  }

  /* --------------------------- generation watch -------------------------- */

  private armWatchdogs(widget: AdWidget): void {
    this.lifetimeTimer = window.setTimeout(() => this.finalize("superseded"), MAX_AD_LIFETIME_MS);
    // If the host is removed by the site (route change, re-render), settle the
    // impression instead of holding the "one ad at a time" lock forever.
    this.connectionTimer = window.setInterval(() => {
      if (this.activeWidget && !widget.host.isConnected) {
        // Attempt reanchor before concluding the tab navigated (e.g. Gemini Angular turn replacement)
        const slot =
          this.activeLease?.placement === "above_composer"
            ? this.adapter.getAboveComposerSlot()
            : this.adapter.getThinkingSlot();
        if (slot) {
          widget.reanchor(slot);
          if (widget.host.isConnected) return;
        }
        this.finalize("navigated");
      }
    }, 1_000);
  }

  /**
   * Scoped observer: attached to the response region, never document.body.
   * Output is considered new only when a different AI message node exists than
   * the one present at submit time, so a previous completed answer cannot end
   * the ad instantly.
   */
  private watchGeneration(widget: AdWidget, initialAiNode: HTMLElement | null): void {
    // The baseline is the answer that existed at submit, not at mount.
    this.initialAiNode = initialAiNode;

    const threadRoot =
      document.querySelector<HTMLElement>(
        "div[data-thread-user-message-navigation-content], .thread-scroll-container, [data-chatgpt-conversation-selection-target], [data-app-shell-focus-area='main'], main",
      ) ??
      initialAiNode?.closest<HTMLElement>(".thread-scroll-container, [data-thread-user-message-navigation-content], main") ??
      document.body;

    const completeSelector = this.adapter.config.generationCompleteSelector;
    let stopSeen = false;

    const check = () => {
      if (!this.activeWidget || this.activeLease?.closed) return;

      // Track stop button lifecycle (Stop button appears while generating and disappears when done)
      const stopBtn = document.querySelector(
        "button[aria-label*='Stop' i], button[data-testid='stop-button']",
      );
      if (stopBtn) {
        stopSeen = true;
      } else if (stopSeen) {
        // Generation finished!
        this.teardownObserver();
        if (this.activeLease?.displayMode === "wait_time_only" && this.activeWidget) {
          this.finalize("stream_started");
        }
        return;
      }

      const latest = this.adapter.findLatestAiMessage();
      const isNew = this.initialAiNode === null ? latest !== null : latest !== null && latest !== this.initialAiNode;
      const textLen = latest?.textContent?.trim().length ?? 0;
      // Some frameworks reuse the assistant container across turns. Treat text
      // growth in the same node as output too, so strict mode still closes on
      // the first token instead of waiting for the whole answer.
      const outputStarted = isNew
        ? textLen > 0
        : this.initialAiNode !== null && latest === this.initialAiNode && textLen > this.initialAiTextLen;

      if (outputStarted) {
        if (this.firstOutputAt === null) {
          this.firstOutputAt = Date.now();
        }
        if (this.activeLease?.displayMode === "wait_time_only") {
          this.teardownObserver();
          this.finalize("stream_started");
          return;
        }
      }

      const complete = latest ? (latest.matches(completeSelector) || latest.querySelector(completeSelector) !== null) : false;
      if (complete) {
        this.teardownObserver();
        if (this.activeLease?.displayMode === "wait_time_only" && this.activeWidget) {
          this.finalize("stream_started");
        }
      }
    };

    this.generationObserver = new MutationObserver(check);
    this.generationObserver.observe(threadRoot, { childList: true, subtree: true, characterData: true });

    // IMPORTANT: Remove polling in strict wait_time_only mode as per user requirements
    // "response doesnot include thinking, loading process" means immediate closure on output
    if (this.activeLease?.displayMode === "wait_time_only") {
      // Poll only via the MutationObserver which is sufficient for strict mode
      // Remove the polling interval to reduce resource usage and prevent layout shifts
      this.generationInterval = null;
      this.generationCleanupTimer = window.setTimeout(() => this.teardownObserver(), MAX_AD_LIFETIME_MS);
    } else {
      // Keep polling for persist mode
      this.generationInterval = window.setInterval(check, 50);
      this.generationCleanupTimer = window.setTimeout(() => this.teardownObserver(), MAX_AD_LIFETIME_MS);
    }

    check();
  }

  private teardownObserver(): void {
    this.generationObserver?.disconnect();
    this.generationObserver = null;
    if (this.generationInterval !== null) {
      clearInterval(this.generationInterval);
      this.generationInterval = null;
    }
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

  /**
   * Request a close. A reader who is hovering keeps the ad (and its hover
   * metrics) until the pointer leaves, bounded by HOVER_HOLD_MAX_MS. An explicit
   * dismiss or snooze always closes immediately.
   */
  private finalize(reason: CloseReason): void {
    const widget = this.activeWidget;
    const lease = this.activeLease;
    if (!widget || !lease || lease.closed) return;

    // An explicit dismiss/snooze always wins over a held close. The widget
    // button handler already removed the host, so settle immediately rather
    // than dropping the impression on the floor.
    if (lease.pendingClose !== null) {
      if (reason === "dismissed" || reason === "snoozed") {
        lease.pendingClose = null;
        this.settle(reason);
      }
      return;
    }

    const interruptible = reason !== "dismissed" && reason !== "snoozed";
    if (interruptible && widget.isUserHovering) {
      lease.pendingClose = reason;
      this.teardownObserver();
      this.clearWatchdogs();
      if (widget.holdUntilPointerLeave(() => this.settle(lease.pendingClose ?? reason))) {
        return;
      }
      lease.pendingClose = null;
    }

    this.settle(reason);
  }

  private settle(reason: CloseReason): void {
    const widget = this.activeWidget;
    const lease = this.activeLease;
    if (!widget || !lease || lease.closed) return;

    lease.closed = true;
    lease.pendingClose = null;
    this.teardownObserver();
    this.clearWatchdogs();
    this.stopWatchingReanchor();
    if (this.themeCleanup) {
      this.themeCleanup();
      this.themeCleanup = null;
    }
    this.preSubmitUserMsgKey = null;

    const requiredMs = (widget.ad.durationSec ?? 5) * 1_000;
    const cumulativeVisibleMs = Math.min(MAX_EVENT_MS, Math.round(widget.timer.cumulativeMs));
    const earned = cumulativeVisibleMs >= requiredMs;
    const aiWaitDurationMs = Math.min(
      MAX_EVENT_MS,
      Math.max(0, Math.round((this.firstOutputAt ?? Date.now()) - lease.submittedAt)),
    );
    const aiMutationVerified = this.firstOutputAt !== null;
    this.firstOutputAt = null;

    const hoverMs = Math.min(MAX_EVENT_MS, Math.round(widget.hover.hoverMs));
    const hoverIntentional = widget.hover.intentional;
    const leaseToken = widget.ad.leaseToken;

    widget.destroy(reason === "earned" || earned);
    this.activeWidget = null;
    this.activeLease = null;
    this.initialAiNode = null;
    this.initialAiTextLen = 0;

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
      durationSec: widget.ad.durationSec ?? 5,
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

  private async recordPrompt(): Promise<void> {
    const now = Date.now();
    let counter = await storageGet<PromptCounter>(STORAGE_KEYS.PROMPT_COUNTER, {
      windowStart: now,
      count: 0,
    });
    if (now - counter.windowStart > PACING.WINDOW_SECONDS * 1000) {
      counter = { windowStart: now, count: 0 };
    }
    counter.count++;
    await storageSet(STORAGE_KEYS.PROMPT_COUNTER, counter);
  }

  /**
   * Ad-only pacing. Counting mounted ads (not prompts) means a user can chat
   * all they want; only the number of ads actually delivered is capped.
   */
  private async pacingAllows(): Promise<boolean> {
    const now = Date.now();
    let counter = await storageGet<PromptCounter>(STORAGE_KEYS.AD_COUNTER, {
      windowStart: now,
      count: 0,
    });
    if (now - counter.windowStart > PACING.WINDOW_SECONDS * 1000) {
      return true;
    }
    if (counter.count < PACING.TIER1_MAX_PER_HOUR) return true;
    if (counter.count < PACING.TIER2_MAX_PER_HOUR) {
      return counter.count % PACING.TIER2_PROMPT_DIVISOR === 0;
    }
    return false; // Tier 3: silent cap for the rest of the window.
  }

  private async bumpAdCounter(): Promise<void> {
    const now = Date.now();
    let counter = await storageGet<PromptCounter>(STORAGE_KEYS.AD_COUNTER, {
      windowStart: now,
      count: 0,
    });
    if (now - counter.windowStart > PACING.WINDOW_SECONDS * 1000) {
      counter = { windowStart: now, count: 0 };
    }
    counter.count++;
    await storageSet(STORAGE_KEYS.AD_COUNTER, counter);
  }
}

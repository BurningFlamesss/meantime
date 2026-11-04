import { PLATFORM_CONFIGS } from "@meantime/shared";
import { BaseAdapter, type MountTarget } from "./base";

export class OpenAiAdapter extends BaseAdapter {
  readonly platformId = "openai";
  readonly config = PLATFORM_CONFIGS.openai;

  override getMessageKey(node: HTMLElement | null): string | HTMLElement | null {
    if (!node) return null;
    return (
      node.getAttribute("data-message-id") ??
      node.closest("li[id]")?.id ??
      node.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids") ??
      node
    );
  }

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    const bubble = latestMessageNode.matches("[data-user-message-bubble='true']")
      ? latestMessageNode
      : latestMessageNode.querySelector<HTMLElement>("[data-user-message-bubble='true']") ?? latestMessageNode;

    // ChatGPT renders an action row (.flex-row-reverse or turn-action-controls) next to / under the user bubble
    const actionRow =
      (bubble.nextElementSibling as HTMLElement | null) ??
      bubble.closest<HTMLElement>(".group\\/user-message, [data-content-search-unit-key], [data-chatgpt-search-unit-key]")?.querySelector<HTMLElement>(".flex-row-reverse, [class*='turn-action-controls']") ??
      latestMessageNode.closest<HTMLElement>(".group\\/user-message")?.querySelector<HTMLElement>(".flex-row-reverse, [class*='turn-action-controls']") ??
      latestMessageNode.querySelector<HTMLElement>(".flex-row-reverse, [class*='turn-action-controls']");

    if (actionRow) {
      if (getComputedStyle(actionRow).position === "static") {
        actionRow.style.position = "relative";
      }
      actionRow.style.width = "100%";
      actionRow.style.minHeight = "32px";
      return { element: actionRow, position: "append" };
    }

    const turn =
      latestMessageNode.closest<HTMLElement>("[data-content-search-unit-key], .group\\/user-message") ??
      latestMessageNode;
    if (getComputedStyle(turn).position === "static") {
      turn.style.position = "relative";
    }
    return { element: turn, position: "append" };
  }

  override getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget | null {
    const turn =
      latestAiNode.closest<HTMLElement>(
        "[data-turn-key], [data-content-search-turn-key], [data-chatgpt-search-unit-key], .group, .block-BQZwFn, article",
      ) ?? latestAiNode.parentElement ?? latestAiNode;

    // Search for the assistant action controls container or buttons
    const controls = turn.querySelector<HTMLElement>("[class*='turn-action-controls'], .turn-action-controls");
    const actionBtn = controls
      ? null
      : turn.querySelector<HTMLElement>(
          "button[aria-label*='Copy' i], button[aria-label*='Read aloud' i], button[aria-label*='Share' i], button[aria-label*='Try again' i], button[aria-label*='Regenerate' i], button[aria-label*='Good' i], button[aria-label*='Bad' i], button[aria-label*='More' i]",
        );

    let actionRow: HTMLElement | null = null;
    if (controls) {
      actionRow = controls.parentElement ?? controls;
    } else if (actionBtn) {
      // Must NOT match actionBtn itself — climb to parent container
      actionRow =
        actionBtn.parentElement?.closest<HTMLElement>(".flex.items-center, [class*='actionRow'], .flex.gap-1, .flex.gap-0\\.5") ??
        actionBtn.parentElement;
    }

    if (actionRow) {
      if (getComputedStyle(actionRow).position === "static") {
        actionRow.style.position = "relative";
      }
      actionRow.style.width = "100%";
      actionRow.style.minHeight = "32px";
      return { element: actionRow, position: "append" };
    }

    return null;
  }

  override getThinkingSlot(): MountTarget | null {
    // Only match ACTIVE thinking indicator, NEVER completed "Thought for X s" button!
    const selector = [
      "button[aria-label*='Thinking' i]",
      "div[data-testid='thinking-indicator']",
      "[data-component='thinking']",
      "[data-state='thinking']",
      "[data-testid*='reasoning']:not([data-state='complete'])",
      "button:has(.loading-shimmer)",
      "span:has(> .loading-shimmer)",
      "div:has(> svg.animate-spin)",
      "button:has(svg.animate-spin)",
      "div[class*='thinking' i]:not([class*='thought' i])",
    ].join(", ");

    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    let latest: HTMLElement | null = matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;

    if (!latest) {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
      for (let i = buttons.length - 1; i >= 0; i--) {
        const btn = buttons[i];
        if (!btn) continue;
        const txt = btn.textContent?.trim().toLowerCase() ?? "";
        // Match only active "thinking", NEVER "thought"
        if (txt.startsWith("thinking")) {
          latest = btn;
          break;
        }
      }
    }

    if (!latest) return null;

    const container =
      (latest instanceof HTMLButtonElement || latest.tagName === "BUTTON" ? latest.parentElement : null) ??
      latest.parentElement?.closest<HTMLElement>(".flex.items-center, div:has(> button)") ??
      latest.parentElement ??
      latest;

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.style.width = "100%";
    container.style.minHeight = "32px";
    return { element: container, position: "append" };
  }

  override getAboveComposerSlot(): MountTarget | null {
    const portal = this.qs<HTMLElement>("[data-above-composer-portal='true']");
    if (portal) {
      if (getComputedStyle(portal).position === "static") {
        portal.style.position = "relative";
      }
      return { element: portal, position: "append" };
    }

    const input = this.qs<HTMLElement>(this.config.promptInputSelector);
    const form = input?.closest<HTMLElement>("form") ?? this.qs<HTMLElement>("form[data-chatgpt-composer], form");
    if (form) {
      // NEVER overwrite position: sticky on composer forms!
      if (getComputedStyle(form).position === "static") {
        form.style.position = "relative";
      }
      return { element: form, position: "append" };
    }

    const composerArea = input?.closest<HTMLElement>(".composer-parent, [class*='composer-bar'], [data-composer-surface]") ?? input?.parentElement;
    if (composerArea) {
      if (getComputedStyle(composerArea).position === "static") {
        composerArea.style.position = "relative";
      }
      return { element: composerArea, position: "append" };
    }

    return null;
  }

  override findLatestAiMessage(): HTMLElement | null {
    // Modern ChatGPT uses div[data-turn-key] or article. An assistant turn is any turn
    // that does not contain a user message bubble.
    const turns = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-turn-key], [data-chatgpt-search-unit-key$=':assistant'], [data-content-search-unit-key$=':assistant'], [data-message-author-role='assistant'], article[data-testid*='conversation-turn']",
      ),
    );
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (!turn) continue;
      if (turn.querySelector("[data-user-message-bubble='true'], [data-conversation-role='user'], [data-chatgpt-search-unit-key$=':user']")) {
        continue;
      }
      const content = turn.querySelector<HTMLElement>(".markdown, [data-markdown-text-style='assistant-message'], .text-size-chat, [class*='prose']");
      return content ?? turn;
    }
    return this.last(this.config.aiMessageSelector);
  }
}

export class GeminiAdapter extends BaseAdapter {
  readonly platformId = "gemini";
  readonly config = PLATFORM_CONFIGS.gemini;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    const action = latestMessageNode.querySelector<HTMLElement>(".query-actions, [class*='actions']") ?? latestMessageNode;
    action.style.position = "relative";
    return { element: action, position: "append" };
  }
}

export class ClaudeAdapter extends BaseAdapter {
  readonly platformId = "claude";
  readonly config = PLATFORM_CONFIGS.claude;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    for (const sel of ["[data-cds='UserMessage']", "[data-user-message-bubble]"]) {
      const bubble = latestMessageNode.closest<HTMLElement>(sel);
      if (bubble?.parentElement) {
        bubble.parentElement.style.position = "relative";
        return { element: bubble.parentElement, position: "append" };
      }
    }
    latestMessageNode.style.position = "relative";
    return { element: latestMessageNode, position: "append" };
  }
}

export class DeepseekAdapter extends BaseAdapter {
  readonly platformId = "deepseek";
  readonly config = PLATFORM_CONFIGS.deepseek;
}

export class GrokAdapter extends BaseAdapter {
  readonly platformId = "grok";
  readonly config = PLATFORM_CONFIGS.grok;

  /** x.com hosts Grok only under /i/grok; grok.com matches everywhere. */
  override matches(hostname: string, pathname: string): boolean {
    const host = hostname.toLowerCase();
    if (host === "grok.com" || host.endsWith(".grok.com")) return true;
    if (host === "x.com" || host.endsWith(".x.com")) {
      return pathname.startsWith("/i/grok");
    }
    return false;
  }
}

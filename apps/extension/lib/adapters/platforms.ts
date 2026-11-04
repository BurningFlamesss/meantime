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
      actionRow.style.position = "relative";
      actionRow.style.width = "100%";
      actionRow.style.minHeight = "32px";
      return { element: actionRow, position: "append" };
    }

    const turn =
      latestMessageNode.closest<HTMLElement>("[data-content-search-unit-key], .group\\/user-message") ??
      latestMessageNode;
    turn.style.position = "relative";
    return { element: turn, position: "append" };
  }

  override getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget {
    const searchUnit =
      latestAiNode.closest<HTMLElement>("[data-chatgpt-search-unit-key], [data-turn-key]") ?? latestAiNode;
    const actionRow =
      searchUnit.querySelector<HTMLElement>(".turn-action-controls, [class*='turn-action-controls']")?.parentElement ??
      searchUnit.querySelector<HTMLElement>(".flex.items-center, [class*='actionRow']") ??
      latestAiNode.querySelector<HTMLElement>(".turn-action-controls, [class*='turn-action-controls'], .flex.items-center");

    if (actionRow) {
      actionRow.style.position = "relative";
      actionRow.style.minHeight = "32px";
      return { element: actionRow, position: "append" };
    }

    searchUnit.style.position = "relative";
    return { element: searchUnit, position: "append" };
  }

  override getThinkingSlot(): MountTarget | null {
    const selector = [
      "button[aria-label*='Thought' i]",
      "button[aria-label*='Thinking' i]",
      "div[data-testid='thinking-indicator']",
      "[data-component='thinking']",
      "[data-state='thinking']",
      "[data-testid*='reasoning']",
      "div[class*='thinking' i]",
      "div[class*='thought' i]",
      "div[class*='reasoning' i]",
      "span:has(> .loading-shimmer)",
    ].join(", ");

    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const latest = matches[matches.length - 1];
    if (!latest) return null;

    const container = latest instanceof HTMLButtonElement || latest.tagName === "BUTTON"
      ? (latest.parentElement ?? latest)
      : latest;
    container.style.position = "relative";
    return { element: container, position: "append" };
  }

  override getAboveComposerSlot(): MountTarget | null {
    const portal = this.qs<HTMLElement>("[data-above-composer-portal='true']");
    if (portal) {
      portal.style.position = "relative";
      return { element: portal, position: "append" };
    }

    const input = this.qs<HTMLElement>(this.config.promptInputSelector);
    const form = input?.closest<HTMLElement>("form") ?? this.qs<HTMLElement>("form[data-chatgpt-composer], form");
    if (form) {
      form.style.position = "relative";
      return { element: form, position: "append" };
    }

    const composerArea = input?.closest<HTMLElement>(".composer-parent, [class*='composer-bar'], [data-composer-surface]") ?? input?.parentElement;
    if (composerArea) {
      composerArea.style.position = "relative";
      return { element: composerArea, position: "append" };
    }

    return null;
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

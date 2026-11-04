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
    // Turn container parent gives a full-width row between user prompt and assistant reply
    const searchUnit = latestMessageNode.closest<HTMLElement>("[data-chatgpt-search-unit-key]");
    const anchor =
      searchUnit?.parentElement ??
      latestMessageNode.closest<HTMLElement>(".block-BQZwFn, [data-turn-key]") ??
      latestMessageNode;

    return { element: anchor, position: "after" };
  }

  override getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget {
    const searchUnit = latestAiNode.closest<HTMLElement>("[data-chatgpt-search-unit-key]");
    const anchor =
      searchUnit?.parentElement ??
      latestAiNode.closest<HTMLElement>(".block-BQZwFn, [data-turn-key]") ??
      latestAiNode;

    return { element: anchor, position: "after" };
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

    if (latest instanceof HTMLButtonElement || latest.tagName === "BUTTON") {
      return { element: latest.parentElement ?? latest, position: "after" };
    }
    return { element: latest, position: "append" };
  }

  override getAboveComposerSlot(): MountTarget | null {
    const portal = this.qs<HTMLElement>("[data-above-composer-portal='true']");
    if (portal) return { element: portal, position: "append" };

    const input = this.qs<HTMLElement>(this.config.promptInputSelector);
    const form = input?.closest("form") ?? this.qs<HTMLElement>("form[data-chatgpt-composer]");
    if (form) {
      return { element: form, position: "before" };
    }

    return null;
  }
}

export class GeminiAdapter extends BaseAdapter {
  readonly platformId = "gemini";
  readonly config = PLATFORM_CONFIGS.gemini;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    return { element: latestMessageNode, position: "after" };
  }
}

export class ClaudeAdapter extends BaseAdapter {
  readonly platformId = "claude";
  readonly config = PLATFORM_CONFIGS.claude;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    for (const sel of ["[data-cds='UserMessage']", "[data-user-message-bubble]"]) {
      const bubble = latestMessageNode.closest<HTMLElement>(sel);
      if (bubble?.parentElement) return { element: bubble.parentElement, position: "after" };
    }
    return { element: latestMessageNode, position: "after" };
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

import { PLATFORM_CONFIGS } from "@meantime/shared";
import { BaseAdapter, type MountTarget } from "./base";

function anchorFor(el: HTMLElement): HTMLElement {
  return (
    el.closest<HTMLElement>("[data-chatgpt-search-unit-key]")?.parentElement ??
    el.closest<HTMLElement>("[data-turn-key]") ??
    el.closest<HTMLElement>(".group\\/user-message")?.parentElement ??
    el
  );
}

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
      actionRow.style.minHeight = "44px";
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

    // Find the action buttons that are OUTSIDE the markdown/prose content
    const allBtns = turn.querySelectorAll<HTMLElement>(
      "button[aria-label*='Copy' i], button[aria-label*='Read aloud' i], button[aria-label*='Share' i], button[aria-label*='Try again' i], button[aria-label*='Regenerate' i], button[aria-label*='Good' i], button[aria-label*='Bad' i], button[aria-label*='More' i]",
    );

    for (let i = allBtns.length - 1; i >= 0; i--) {
      const btn = allBtns[i];
      if (!btn) continue;
      // Skip buttons that are inside the response prose/markdown
      if (btn.closest(".markdown, [data-markdown-text-style], .text-size-chat, [class*='prose']")) continue;

      // Find the flex row containing this action button
      let flexRow = btn.closest<HTMLElement>("[class*='turn-action-controls'], .turn-action-controls");
      if (!flexRow) {
        let parent = btn.parentElement;
        while (parent && parent !== turn) {
          if (parent.closest(".markdown, [data-markdown-text-style], .text-size-chat, [class*='prose']")) {
            parent = null;
            break;
          }
          if (parent.querySelectorAll("button").length >= 2) {
            flexRow = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (flexRow && !flexRow.closest(".markdown, [data-markdown-text-style], .text-size-chat, [class*='prose']")) {
        return { element: flexRow, position: "append" };
      }
    }

    // Fallback: look for the action controls container directly
    const controls = turn.querySelector<HTMLElement>("[class*='turn-action-controls'], .turn-action-controls");
    if (controls && !controls.closest(".markdown, [data-markdown-text-style], .text-size-chat, [class*='prose']")) {
      return { element: controls, position: "append" };
    }

    return null;
  }

  override getThinkingSlot(): MountTarget | null {
    // Reference-to-take technique: anchor after the user prompt turn container.
    // This inserts the ad in a full-width block row directly above the thinking bubble
    // and AI response, active throughout the thinking time and without obscuring content.
    const user = this.findLatestUserMessage();
    if (user) {
      return { element: anchorFor(user), position: "after" };
    }
    return null;
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
    const userQuery = latestMessageNode.closest<HTMLElement>("user-query") ?? latestMessageNode;
    return { element: userQuery, position: "after" };
  }

  override getThinkingSlot(): MountTarget | null {
    const user = this.findLatestUserMessage();
    if (user) return this.getUserMessageActionSlot(user);
    return null;
  }

  override getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget | null {
    const modelResponse = latestAiNode.closest<HTMLElement>("model-response") ?? latestAiNode;
    const actions = modelResponse.querySelector<HTMLElement>("message-actions, .response-container-footer, [class*='actions']");
    if (actions) {
      return { element: actions, position: "after" };
    }
    return { element: modelResponse, position: "after" };
  }

  override getAboveComposerSlot(): MountTarget | null {
    const composerArea = this.qs<HTMLElement>(".input-area-container, .input-area, rich-textarea");
    if (composerArea) {
      return { element: composerArea, position: "before" };
    }
    return null;
  }

  override getMessageKey(node: HTMLElement | null): string | HTMLElement | null {
    if (!node) return null;
    const text = node.textContent?.trim().slice(0, 40);
    return node.getAttribute("id") ?? (text ? `g_${text}` : node);
  }

  override findLatestUserMessage(): HTMLElement | null {
    return this.last("user-query");
  }

  override findLatestAiMessage(): HTMLElement | null {
    return this.last("model-response, pending-response, message-content");
  }
}

export class ClaudeAdapter extends BaseAdapter {
  readonly platformId = "claude";
  readonly config = PLATFORM_CONFIGS.claude;

  override getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget {
    for (const sel of ["[data-cds='UserMessage']", "[data-user-message-bubble]"]) {
      const bubble = latestMessageNode.closest<HTMLElement>(sel);
      if (bubble?.parentElement) {
        return { element: bubble.parentElement, position: "after" };
      }
    }
    return { element: latestMessageNode, position: "after" };
  }

  override getThinkingSlot(): MountTarget | null {
    const user = this.findLatestUserMessage();
    if (user) return this.getUserMessageActionSlot(user);
    return null;
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

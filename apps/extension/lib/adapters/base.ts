import type { PlatformSelectorConfig } from "@meantime/shared";

export type MountPosition = "after" | "before" | "append";

export interface MountTarget {
  element: HTMLElement;
  position: MountPosition;
}

/**
 * Implement this interface to add a new AI platform. A minimal adapter is a
 * selector config plus anchor-locator functions.
 */
export interface PlatformAdapter {
  readonly platformId: string;
  readonly hostPatterns: string[];
  readonly config: PlatformSelectorConfig;

  matches(hostname: string, pathname: string): boolean;

  /** Anchor under the user's just-submitted prompt bubble (primary position). */
  getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget | HTMLElement | null;
  /** Anchor at the footer of the AI response block. */
  getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget | HTMLElement | null;
  /** Anchor next to the "Thinking..." indicator. */
  getThinkingSlot(): MountTarget | HTMLElement | null;
  /** Anchor strictly above the prompt / composer box without layout shift. */
  getAboveComposerSlot(): MountTarget | HTMLElement | null;

  /** Latest user message node, used as the primary injection anchor. */
  findLatestUserMessage(): HTMLElement | null;
  /** Get unique message key/id to survive DOM node reuse across virtualized lists. */
  getMessageKey(node: HTMLElement | null): string | HTMLElement | null;
  /** Latest AI message node (may still be streaming). */
  findLatestAiMessage(): HTMLElement | null;
}

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platformId: string;
  abstract readonly config: PlatformSelectorConfig;

  get hostPatterns(): string[] {
    return this.config.hostPatterns;
  }

  matches(hostname: string, _pathname: string): boolean {
    const host = hostname.toLowerCase();
    return this.hostPatterns.some((p) => host === p || host.endsWith(`.${p}`));
  }

  protected qs<T extends Element = HTMLElement>(selector: string): T | null {
    return document.querySelector<T>(selector);
  }

  protected qsAll<T extends Element = HTMLElement>(selector: string): T[] {
    return Array.from(document.querySelectorAll<T>(selector));
  }

  /** Last match in document order. */
  protected last<T extends Element = HTMLElement>(selector: string): T | null {
    const all = this.qsAll<T>(selector);
    return all.length > 0 ? (all[all.length - 1] as T) : null;
  }

  findLatestUserMessage(): HTMLElement | null {
    return this.last(this.config.userMessageSelector);
  }

  getMessageKey(node: HTMLElement | null): string | HTMLElement | null {
    if (!node) return null;
    return node.getAttribute("id") ?? node.getAttribute("data-message-id") ?? node;
  }

  findLatestAiMessage(): HTMLElement | null {
    return this.last(this.config.aiMessageSelector);
  }

  getUserMessageActionSlot(latestMessageNode: HTMLElement): MountTarget | HTMLElement | null {
    const action = latestMessageNode.querySelector<HTMLElement>("[class*='action'], footer");
    const target = action ?? latestMessageNode;
    target.style.position = "relative";
    return { element: target, position: "append" };
  }

  getAiMessageFooterSlot(latestAiNode: HTMLElement): MountTarget | HTMLElement | null {
    const action = latestAiNode.querySelector<HTMLElement>("[class*='action'], footer");
    const target = action ?? latestAiNode;
    target.style.position = "relative";
    return { element: target, position: "append" };
  }

  getThinkingSlot(): MountTarget | HTMLElement | null {
    const el = this.qs(this.config.thinkingIndicatorSelector);
    if (!el) return null;
    const target = el instanceof HTMLButtonElement || el.tagName === "BUTTON" ? (el.parentElement ?? el) : el;
    target.style.position = "relative";
    return { element: target, position: "append" };
  }

  getAboveComposerSlot(): MountTarget | HTMLElement | null {
    const portal = this.qs<HTMLElement>("[data-above-composer-portal='true']");
    if (portal) {
      portal.style.position = "relative";
      return { element: portal, position: "append" };
    }
    const input = this.qs<HTMLElement>(this.config.promptInputSelector);
    if (!input) return null;
    const form =
      input.closest("form") ??
      input.closest("[data-chatgpt-composer]") ??
      input.parentElement?.parentElement ??
      input.parentElement;
    if (!form) return null;
    form.style.position = "relative";
    return { element: form, position: "append" };
  }
}

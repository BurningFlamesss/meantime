import type { PlatformId } from "./constants.js";

/**
 * Host/selector configuration shared by the extension's PlatformAdapter
 * implementations and the API's campaign targeting. Selectors live here (not
 * hardcoded in the extension bundle) so a platform DOM change can be patched
 * server-side via the /config endpoint without shipping a new extension build.
 */

export interface PlatformSelectorConfig {
  platformId: PlatformId;
  hostPatterns: string[];
  promptInputSelector: string;
  sendButtonSelector: string;
  thinkingIndicatorSelector: string;
  streamingContainerSelector: string;
  generationCompleteSelector: string;
  userMessageSelector: string;
  aiMessageSelector: string;
}

export const PLATFORM_CONFIGS: Record<PlatformId, PlatformSelectorConfig> = {
  openai: {
    platformId: "openai",
    hostPatterns: ["chatgpt.com", "chat.openai.com"],
    promptInputSelector:
      "div.ProseMirror[contenteditable='true'], div[data-composer-markdown], div[role='textbox'][contenteditable='true'], #prompt-textarea, [data-testid*='prompt-textarea'], div[contenteditable='true']",
    sendButtonSelector:
      "button[data-testid*='send'], button[aria-label*='Send'], button[data-testid='fruitjuice-send-button'], button[data-testid='send-button'], form[data-chatgpt-composer] button[type='submit'], [data-composer-trailing-controls] button:last-child",
    thinkingIndicatorSelector:
      "div[data-testid='thinking-indicator'], button[aria-label*='Thought' i], button[aria-label*='Thinking' i], [data-component='thinking'], [data-state='thinking'], [data-testid*='reasoning'], div[class*='thinking' i], div[class*='thought' i], div[class*='reasoning' i], span:has(> .loading-shimmer)",
    streamingContainerSelector:
      ".DilRenderer-tB76Jj, [data-markdown-text-style='assistant-message'], [data-dil-message-id], [data-message-author-role='assistant'] .markdown, [data-testid*='assistant'] .markdown",
    generationCompleteSelector:
      "button[aria-label='Copy'], button[aria-label='Regenerate response'], [class*='turn-action-controls'], [class*='actionRow'], button[data-testid='copy-turn-action-button']",
    userMessageSelector:
      "[data-user-message-bubble='true'], [data-chatgpt-search-unit-key$=':user'], [data-content-search-unit-key$=':user'], [data-conversation-role='user'], [data-message-author-role='user'], [data-testid*='user-message'], [class*='user-message']",
    aiMessageSelector:
      "[data-markdown-text-style='assistant-message'], .DilRenderer-tB76Jj, [data-dil-message-id], [data-chatgpt-search-unit-key$=':assistant'], [data-content-search-unit-key$=':assistant'], [data-conversation-role='assistant'], [data-message-author-role='assistant'], [data-testid*='assistant']",
  },
  gemini: {
    platformId: "gemini",
    hostPatterns: ["gemini.google.com"],
    promptInputSelector:
      "rich-textarea [contenteditable], div.ql-editor[contenteditable='true'], rich-textarea div[contenteditable='true'], [contenteditable='true'][role='textbox'], p[data-placeholder]",
    sendButtonSelector:
      "button[aria-label*='Send' i], button.send-button, .send-button-container button, button[data-test-id*='send'], button:has(mat-icon[fonticon='send'])",
    thinkingIndicatorSelector: ".loading-indicator, .spark-throbber, pending-response, .thinking-container",
    streamingContainerSelector: "message-content .markdown, message-content, model-response .markdown",
    generationCompleteSelector: "response-container .response-container-footer, message-actions, model-response message-actions",
    userMessageSelector: "user-query",
    aiMessageSelector: "model-response, pending-response",
  },
  grok: {
    platformId: "grok",
    hostPatterns: ["grok.com", "x.com"],
    promptInputSelector: "div[contenteditable='true'].notranslate, textarea[aria-label*='Ask']",
    sendButtonSelector: "button[type='submit'], button[aria-label='Send']",
    thinkingIndicatorSelector: "div[role='status'], .thinking-bubble",
    streamingContainerSelector: "div.message-bubble .markdown",
    generationCompleteSelector: "div.action-bar button[aria-label='Copy']",
    userMessageSelector: "div[data-testid='user-message'], div.message-bubble.human",
    aiMessageSelector: "div[data-testid='ai-message'], div.message-bubble.ai",
  },
  claude: {
    platformId: "claude",
    hostPatterns: ["claude.ai"],
    promptInputSelector: "div.ProseMirror[contenteditable='true']",
    sendButtonSelector: "button[aria-label='Send Message'], button[aria-label='Send message']",
    thinkingIndicatorSelector: "div[data-is-streaming='true'], .loading-dots",
    streamingContainerSelector: "div[data-testid='ai-message-content'], .font-claude-message",
    generationCompleteSelector: "button[aria-label='Copy response']",
    userMessageSelector: "div[data-testid='user-message'], .font-user-message",
    aiMessageSelector: "div[data-testid='ai-message'], .font-claude-message",
  },
  deepseek: {
    platformId: "deepseek",
    hostPatterns: ["chat.deepseek.com"],
    promptInputSelector: "textarea#chat-input, div[contenteditable='true']",
    sendButtonSelector: "div[role='button'][aria-label='Send'], button.send-button",
    thinkingIndicatorSelector: ".thinking-status, .loading-dot",
    streamingContainerSelector: "div.ds-markdown",
    generationCompleteSelector: "div.ds-message-actions",
    userMessageSelector: "div.ds-message.human, div[class*='user-message']",
    aiMessageSelector: "div.ds-message.ai, div[class*='ai-message']",
  },
};

export function configForHostname(hostname: string): PlatformSelectorConfig | null {
  const host = hostname.toLowerCase();
  for (const cfg of Object.values(PLATFORM_CONFIGS)) {
    for (const pattern of cfg.hostPatterns) {
      if (host === pattern || host.endsWith(`.${pattern}`)) return cfg;
      // x.com/i/grok path-scoped matching handled by the adapter itself.
    }
  }
  return null;
}

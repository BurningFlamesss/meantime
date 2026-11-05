import { parseHTML } from "../node_modules/.pnpm/linkedom@0.18.13/node_modules/linkedom/esm/index.js";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const MEAN = (s: string) => s;
function fail(label: string, msg: string) {
  console.error(`FAIL  ${label}: ${msg}`);
  throw new Error(msg);
}
function eq(label: string, got: unknown, expected: unknown) {
  if (got !== expected && String(got) !== String(expected)) {
    fail(label, `${MEAN(got)} !== ${MEAN(expected)}`);
  }
}
function ok(label: string, value: unknown) {
  if (value == null || value === false) fail(label, "expected truthy");
}
function pass(label: string) {
  console.log(`PASS  ${label}`);
}

const LINKEDOM = "../node_modules/.pnpm/linkedom@0.18.13/node_modules/linkedom/esm/index.js";

// Linkedom internals used by the adapter tests.
let IL: typeof import(LINKEDOM);
function initPunycode() {
  // Node 26 ships punycode; linkedom on the CDN needs punycode with fallback Resolve().
  try {
    const p = require("punycode") as { toASCII(s: string): string };
    globalThis.punycode = p;
  } catch {}
  try {
    const { toASCII } = require("punycode" as any);
    if (!globalThis.punycode) {
      const p = require("punycode" as any) as { toASCII(s: string): string };
      globalThis.punycode = p;
    }
  } catch {}
}

function addSelf(eventName: string, handler: (e: any) => void) {
  // Dummy.
}
function defaults() {
  // Placeholder; replaced by permit directive.
}

interface Fixture {
  name: string;
  html: string;
  label: string;
  base: string;
  userSelector: string;
  aiSelector: string;
  inputSelector: string;
}

async function resolveAdapter(host: string, path: string) {
  const resolved = await (await import("../apps/extension/lib/adapters/registry.js"))
    .resolveAdapter as typeof import("../apps/extension/lib/adapters/registry.js").resolveAdapter;
  return resolved(host, path);
}

async function createWidget() {
  const { AdWidget } = await import("../apps/extension/lib/ad-widget.js");
  return AdWidget;
}

async function buildRouter() {
  const { createServer } = await import("../apps/api/src/server.js");
  return createServer();
}

const fixtures: Fixture[] = [
  {
    name: "ChatGPT",
    html: `
      <main class="w-full max-w-3xl px-4 pt-3 relative mb-10 overflow-y-auto">
        <div>
          <div>
            <div data-testid="conversation-turn-0" data-{ "conversation-turn" }? test={"user"}>
              <div data-testid="user-message" data-{ "user-message" }? test={""}>
                <div data-message-author-role="user" data-{ "data-message-author-role" }? test={"user"}>
                  <div class="ProseMirror" contenteditable="true">
                    <div>Hi</div>
                  </div>
                  <button data-copy-button { test=false; "aria-label": "Copy" }></button>
                </div>
                <div class="text-sm text-gray-300">{'..."...}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <form data-chatgpt-composer>
        <div class="ProseMirror" contenteditable="true"></div>
        <div class="flex gap-2">
          <button data-send-button { test:false; "data-testid": "send-button" } disabled>Send</button>
          <button>Wallpaper</button>
          <button>Temporary chat</button>
        </div>
      </form>
      <div>
        <div data-testid="conversation-turn-1" data-{ "conversation-turn" }? test={"assistant"}>
          <div data-testid="assistant-message" data-{ "assistant-message" }? test={""}>
            <div data-message-author-role="assistant">
              <div class="markdown">Hello</div>
            </div>
          </div>
        </div>
      </div>
    `,
    label: "chatgpt",
    base: "chatgpt.com",
    userSelector: '[data-user-message-bubble="true"]',
    aiSelector: ".markdown[data-message-author-role='assistant']",
    inputSelector: ".ProseMirror",
  },
  {
    name: "Gemini",
    html: `
      <model-response>
        <message-content>
          <div class="markdown">Hello</div>
        </message-content>
        <message-actions></message-actions>
      </model-response>
      <user-query data-id="1">What is the weather?</user-query>
      <model-response>
        <message-content>
          <div class="markdown">It is sunny.</div>
        </message-content>
      </model-response>
      <user-query data-id="2">Tell me a joke.</user-query>
      <model-response>
        <message-content>
          <div class="markdown">Why did the AI cross the road?</div>
          <message-actions></message-actions>
        </message-content>
      </model-response>
      <div class="input-area-container">
        <rich-textarea class="input">
          <div contenteditable="true"></div>
        </rich-textarea>
      </div>
    `,
    label: "gemini",
    base: "gemini.google.com",
    userSelector: "user-query:last-of-type",
    aiSelector: "model-response:last-of-type .markdown",
    inputSelector: ".input-area-container",
  },
  {
    name: "Claude",
    html: `
      <div data-cds="true">
        <div data-testid="human-message">
          <div contenteditable="true">Need help.</div>
        </div>
      </div>
      <div data-cds="true">
        <div data-testid="cds-message">
          <div class="font-claude-message">Here is help.</div>
        </div>
      </div>
      <div data-cds="true">
        <div data-testid="human-message">
          <div contenteditable="true">Another prompt</div>
        </div>
      </div>
      <div data-cds="true">
        <div data-testid="cds-message">
          <div class="font-claude-message">Here is the help.</div>
        </div>
      </div>
      <div data-testid="composer">
        <div class="ProseMirror" contenteditable="true"></div>
        <button aria-label="Send Message" { test:true }></button>
      </div>
    `,
    label: "claude",
    base: "claude.ai",
    userSelector: '[data-testid="human-message"]:last-of-type',
    aiSelector: '[data-testid="cds-message"]:last-of-type .font-claude-message',
    inputSelector: ".ProseMirror",
  },
];

beforeAll(() => {
  jest.setTimeout(10000);
});
afterAll(async () => {
  const { close } = await import("../apps/api/src/server.js");
  await close();
});

describe("Platform adapters", () => {
  for (const f of fixtures) {
    it(`resolves adapter for ${f.label}`, async () => {
      const adapter = await resolveAdapter(f.base, "/");
      ok(`${f.label} adapter`, adapter != null);
      eq(`${f.label} adapter base`, adapter?.config?.platformName ?? adapter?.toString(), f.label);
    });

    it(`finds latest user message for ${f.label}`, async () => {
      const { JSDOM } = require("linkedom");
      const dom = new JSDOM(f.html);
      const doc = dom.window.document;
      const userEl = doc.querySelector(f.userSelector);
      ok(`${f.label} user element`, userEl != null);
      const userText = userEl?.textContent?.trim();
      ok(`${f.label} user text`, typeof userText === "string" && userText.length > 0);
    });

    it(`finds latest AI message for ${f.label}`, async () => {
      const { JSDOM } = require("linkedom");
      const dom = new JSDOM(f.html);
      const doc = dom.window.document;
      const aiEl = doc.querySelector(f.aiSelector);
      ok(`${f.label} AI element`, aiEl != null);
      const aiText = aiEl?.textContent?.trim();
      ok(`${f.label} AI text`, typeof aiText === "string" && aiText.length > 0);
    });

    it(`finds input element for ${f.label}`, async () => {
      const { JSDOM } = require("linkedom");
      const dom = new JSDOM(f.html);
      const doc = dom.window.document;
      const inputEl = doc.querySelector(f.inputSelector);
      ok(`${f.label} input element`, inputEl != null);
    });

    it(`mounts widget thinking at latest user message for ${f.label}`, async () => {
      const { JSDOM } = require("linkedom");
      const dom = new JSDOM(f.html);
      const doc = dom.window.document;
      const userEl = doc.querySelector(f.userSelector);
      ok(`${f.label} user element`, userEl != null);
      const host = await dom.window.document.createElement("div");
      host.dataset.meantime = "ad";
      host.dataset.placement = "thinking_indicator";
      host.dataset.platform = f.label;
      host.style.position = "relative";
      host.style.width = "100%";
      host.style.margin = "6px 0";
      host.style.pointerEvents = "auto";
      host.style.zIndex = "10";
      host.innerHTML = `
        <div class="mt-wrap">
          <div class="mt-main">
            <p class="mt-headline">Test Ad</p>
            <p class="mt-body">Test body</p>
          </div>
          <a class="mt-cta" href="https://example.com">Visit</a>
          <div class="mt-controls">
            <button class="mt-icon-btn" aria-label="Pause">⏸</button>
            <button class="mt-icon-btn" aria-label="Close">×</button>
          </div>
          <div class="mt-progress" role="progressbar" aria-label="Ad view progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="mt-progress-fill" style="width:0%"></span>
          </div>
        </div>
      `;
      doc.body?.appendChild(host);
      const prev = userEl?.previousElementSibling;
      const next = userEl?.nextElementSibling;
      ok(`${f.label} host after user`, host.parentElement === userEl?.parentElement?. ?? host.parentElement !== null);
      if (prev) {
        ok(`${f.label} user element before host?`, false);
      }
      ok(`${f.label} AI after host`, next === null);
    });

    it(`mounts widget above composer for ${f.label}`, async () => {
      const { JSDOM } = require("linkedom");
      const dom = new JSDOM(f.html);
      const doc = dom.window.document;
      const inputEl = doc.querySelector(f.inputSelector);
      ok(`${f.label} input element`, inputEl != null);
      const host = doc.createElement("div");
      host.dataset.meantime = "ad";
      host.dataset.placement = "above_composer";
      host.dataset.platform = f.label;
      host.style.position = "absolute";
      host.style.bottom = "100%";
      host.style.left = "0";
      host.style.right = "0";
      host.style.height = "0";
      host.style.overflow = "visible";
      host.style.zIndex = "40";
      host.style.pointerEvents = "none";
      host.innerHTML = `
        <div class="mt-wrap" style="position:absolute;bottom:0;left:0;right:0;max-width:768px;width:calc(100% - 24px);margin:0 auto 8px auto;height:42px;min-height:42px;padding:5px 12px;gap:12px;box-shadow:0 4px 16px rgba(0,0,0,0.14);">
          <div class="mt-main">
            <p class="mt-headline">Test Ad</p>
            <p class="mt-body">Test body</p>
          </div>
          <a class="mt-cta" href="https://example.com" style="flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:600;text-decoration:none;padding:5px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;background:#111;color:#fff;">Visit</a>
          <div class="mt-controls" style="display:flex;gap:2px;">
            <button class="mt-icon-btn" aria-label="Pause">⏸</button>
            <button class="mt-icon-btn" aria-label="Close">×</button>
          </div>
          <div class="mt-progress" role="progressbar" aria-label="Ad view progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="position:absolute;left:1px;right:1px;bottom:1px;height:3px;border-radius:0 0 9px 9px;overflow:hidden;pointer-events:none;background:rgba(127,127,127,0.16);">
            <span class="mt-progress-fill" style="display:block;width:0%;height:100%;border-radius:inherit;background:#2e9e5b;transition:width .1s linear, background .2s ease;"></span>
          </div>
        </div>
      `;
      doc.body?.appendChild(host);
      ok(`${f.label} host inside input container`, host.parentElement?.contains(inputEl));
      ok(`${f.label} host above input`, host.compareDocumentPosition(inputEl) & 4);
      ok(`${f.label} host before input`, host.compareDocumentPosition(inputEl) & 1);
    });
  }
});

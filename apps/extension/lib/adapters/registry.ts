import type { PlatformAdapter } from "./base";
import { ClaudeAdapter, GeminiAdapter, OpenAiAdapter } from "./platforms";

// Only these three domains are activated. Grok/DeepSeek adapters are kept for
// future rollout, but they are deliberately not registered or matched.
const ADAPTERS: PlatformAdapter[] = [
  new OpenAiAdapter(),
  new GeminiAdapter(),
  new ClaudeAdapter(),
];

export function resolveAdapter(hostname: string, pathname: string): PlatformAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.matches(hostname, pathname)) return adapter;
  }
  return null;
}

export function supportedHostPatterns(): string[] {
  return ADAPTERS.flatMap((a) =>
    a.hostPatterns.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]),
  );
}

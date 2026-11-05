import type { PlatformAdapter } from "./base";
import {
  ClaudeAdapter,
  DeepseekAdapter,
  GeminiAdapter,
  GrokAdapter,
  OpenAiAdapter,
} from "./platforms";

const ADAPTERS: PlatformAdapter[] = [
  new OpenAiAdapter(),
  new GeminiAdapter(),
  new ClaudeAdapter(),
  new GrokAdapter(),
  new DeepseekAdapter(),
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

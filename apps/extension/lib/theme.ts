import type { ThemePreference } from "@meantime/shared";

export type ResolvedTheme = "light" | "dark";

/**
 * Detects whether the current host page is rendered in light or dark mode.
 * Checks DOM classes (e.g. ChatGPT / Claude .dark), data-theme attributes,
 * computed background lightness, and OS prefers-color-scheme.
 */
export function detectSiteTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";

  const docEl = document.documentElement;
  const body = document.body;

  // 1. Explicit classes used by ChatGPT, Claude, Tailwind, and custom themes
  if (
    docEl?.classList.contains("dark") ||
    body?.classList.contains("dark") ||
    docEl?.classList.contains("dark-theme") ||
    body?.classList.contains("dark-theme")
  ) {
    return "dark";
  }
  if (
    docEl?.classList.contains("light") ||
    body?.classList.contains("light") ||
    docEl?.classList.contains("light-theme") ||
    body?.classList.contains("light-theme")
  ) {
    return "light";
  }

  // 2. Data attributes (e.g. data-theme="dark", data-color-mode="dark")
  const dataTheme =
    docEl?.getAttribute("data-theme") ||
    body?.getAttribute("data-theme") ||
    docEl?.getAttribute("data-color-mode") ||
    docEl?.getAttribute("color-scheme");
  if (dataTheme) {
    const dt = dataTheme.toLowerCase();
    if (dt.includes("dark")) return "dark";
    if (dt.includes("light")) return "light";
  }

  // 3. Computed background color lightness
  try {
    const sampleTargets = [
      document.querySelector("main"),
      body,
      docEl,
    ].filter(Boolean) as HTMLElement[];

    for (const el of sampleTargets) {
      const bg = window.getComputedStyle(el).backgroundColor;
      if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
      const rgb = bg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const r = Number(rgb[0]);
        const g = Number(rgb[1]);
        const b = Number(rgb[2]);
        const a = rgb[3] !== undefined ? Number(rgb[3]) : 1;
        if (a > 0.1) {
          // Relative luminance (sRGB perceived lightness)
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          return luminance < 128 ? "dark" : "light";
        }
      }
    }
  } catch {
    // Fall through on any computed style lookup issues
  }

  // 4. Fallback to OS/browser preference
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return "dark";
}

/**
 * Resolves the theme according to user preference:
 * - "dark" -> forces dark theme
 * - "light" -> forces light theme
 * - "auto" -> inspects host website's theme
 */
export function resolveWidgetTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return detectSiteTheme();
}

/**
 * Observes dynamic theme changes on the host page (e.g. ChatGPT user toggling
 * between dark and light mode without reloading).
 */
export function observeSiteTheme(
  pref: ThemePreference,
  onChange: (theme: ResolvedTheme) => void,
): () => void {
  if (pref !== "auto" || typeof document === "undefined") {
    return () => undefined;
  }

  let current = detectSiteTheme();

  const check = () => {
    const next = detectSiteTheme();
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };

  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "data-color-mode", "style"],
  });

  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", check);

  return () => {
    observer.disconnect();
    media.removeEventListener("change", check);
  };
}

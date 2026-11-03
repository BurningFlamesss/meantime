# MeanTime — Design System

**Status:** Implemented for web + extension  
**Last updated:** 2026-11-03  
**Related docs:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md)

---

## 1. Design intent

MeanTime is an ad product that must not feel like an ad product. The visual
language is deliberately quiet: **white surfaces, neutral type, one restrained
green accent, and almost no decoration.** Colour is reserved for meaning
(success, warning, error), not for branding flourish.

The interface should communicate:

- **Calm** — no gradients, glows, illustrations, or attention-seeking chrome.
- **Trust** — tabular numbers, explicit statuses, visible controls, no hidden
  actions.
- **Craft** — generous spacing, consistent radii, crisp borders, predictable
  alignment.
- **Respect** — the user's content is the hero; our UI gets out of the way.

### Reference keywords

`editorial`, `quiet utility`, `neutral`, `precise`, `transparent`, `text-first`

### Anti-keywords

`growth-hacked`, `gamified`, `flashy`, `ad-tech`, `neon`, `glassmorphism`,
`gradient hero`, `confetti`

---

## 2. Colour

The web app uses Tailwind's default **neutral** scale as its core palette and a
single custom accent.

### 2.1 Core tokens

| Token | Value | Use |
|---|---|---|
| `white` | `#ffffff` | Page and card surfaces. |
| `neutral-50` | `#fafafa` | App background, subtle table hover. |
| `neutral-100` | `#f5f5f5` | Active nav, neutral badges, progress track. |
| `neutral-200` | `#e5e5e5` | Borders, dividers, card outlines. |
| `neutral-300` | `#d4d4d4` | Input borders, outline buttons. |
| `neutral-400` | `#a3a3a3` | Muted icons, placeholder text, disabled hints. |
| `neutral-500` | `#737373` | Secondary text, labels, table headers. |
| `neutral-600` | `#525252` | Body copy on white. |
| `neutral-700` | `#404040` | Form labels, strong secondary text. |
| `neutral-900` | `#171717` | Primary text, primary buttons, active nav. |

### 2.2 Accent

Defined in `apps/web/tailwind.config.js`:

| Token | Value | Use |
|---|---|---|
| `accent` | `#0f7a4d` | Success, earned, positive progress, primary highlight. |
| `accent-soft` | `#e7f4ee` | Success badge background, approved panel background. |

> **Rule:** the accent is an accent. It should never fill a page, a large
> header, or a decorative block. If everything is green, nothing is.

### 2.3 Semantic status

| Meaning | Background | Text | Dot | Where |
|---|---|---|---|---|
| Neutral / unknown | `neutral-100` | `neutral-700` | `neutral-400` | Default badges, pending. |
| Good / earned / approved | `accent-soft` | `accent` | `accent` | Verified, approved, paid. |
| Warning / review | `amber-100` | `amber-800` | `amber-500` | Needs review, throttled, pending review. |
| Bad / rejected / error | `red-100` | `red-700` | `red-500` | Rejected, failed, frozen. |

These map to the `Tone` type in `apps/web/src/lib/ui.tsx`:
`neutral | good | warn | bad`.

### 2.4 Extension colours

The extension cannot assume the host page is light or dark, so it uses
**currentColor + translucent greys** instead of fixed brand colours:

- Container: `rgba(127,127,127,.07)` background,
  `1px solid rgba(127,127,127,.25)` border.
- Text: inherits the host page's colour (`color: inherit`).
- Controls: `rgba(127,127,127,.8)` icons, darkening on hover.
- Menu: `Canvas` / `CanvasText` system colours.
- Earned: `#2e9e5b`.
- Popup: `color-scheme: light dark`, system font stack, `rgba(127,127,127,…)`
  borders and surfaces.

This keeps the ad legible on both light and dark AI interfaces without
injecting a foreign brand palette.

### 2.5 Contrast

- Body text: `neutral-900` on white or `neutral-600` on white.
- Secondary text: no lighter than `neutral-500` on white for meaningful content.
- `neutral-400` is for hints/placeholders only, never essential actions.
- Accent `#0f7a4d` on `#e7f4ee` is the success pairing; do not place accent
  text on `neutral-100` for small type without checking contrast.
- Focus rings use `outline-neutral-900` at 2px with offset.

---

## 3. Typography

### 3.1 Family

```css
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
  Inter, sans-serif;
```

- No webfont downloads. System UI keeps the app fast and native-feeling.
- `font-feature-settings: "ss01", "cv11"` is enabled globally (Inter-friendly
  stylistic alternates where available).
- Antialiasing is enabled on `html`; the body uses `antialiased`.

### 3.2 Scale

| Role | Classes | Notes |
|---|---|---|
| Page title | `text-xl font-semibold tracking-tight` | `PageHeader`. |
| Hero | `text-4xl sm:text-5xl font-semibold leading-tight tracking-tight` | Landing only. |
| Section title | `text-sm font-semibold` | Campaigns, transparency log, etc. |
| Stat value | `text-2xl font-semibold tracking-tight tabular` | `Stat` component. |
| Large balance | `text-3xl font-semibold tracking-tight tabular` | Payouts page. |
| Body | `text-sm` (14px) or `text-base` | Default UI text is 14px. |
| Supporting | `text-[13px] text-neutral-500` | Stat labels. |
| Hint / caption | `text-xs text-neutral-400` | Thresholds, footnotes. |
| Table header | `text-xs uppercase tracking-wide text-neutral-500` | `Table` component. |
| Badge | `text-xs font-medium` | With a 1.5px status dot. |

### 3.3 Rules

- Use **sentence case** for headings, labels, and buttons.
- Use **tabular numerals** (`.tabular` / `font-variant-numeric: tabular-nums`)
  for money, durations, counts, and percentages.
- Do not use all-caps for sentences; only for compact table headers and
  micro-labels.
- Maximum body line length ~65–75 characters; the landing hero is constrained
  to `max-w-xl`/`max-w-3xl`.
- Do not use font weights below 400 or above 600. Semibold is the strongest.

---

## 4. Spacing and layout

### 4.1 Base scale

Tailwind's 4px base scale. Common steps:

| Step | px | Use |
|---|---|---|
| `1` | 4 | Icon gaps, tiny offsets. |
| `1.5` | 6 | Label-to-input, badge padding. |
| `2` | 8 | Button icon gap, compact stacks. |
| `3` | 12 | Form field stacks, table cell vertical rhythm. |
| `4` | 16 | Default gap between related elements. |
| `5` | 20 | Card padding (`card-pad`). |
| `6` | 24 | Section gaps, page header bottom margin. |
| `8` | 32 | Major section separation, page padding. |
| `12` | 48 | Empty-state padding. |
| `16` | 64 | Landing section padding. |
| `24` | 96 | Hero top padding. |

### 4.2 Page shell

```
max-width: 6xl (72rem / 1152px)
horizontal padding: 24px (px-6)
header height: 56px (h-14)
main padding: 32px top/bottom (py-8)
app background: neutral-50
```

The header is `sticky top-0 z-20`, white/80 with `backdrop-blur`, and a
`neutral-200` bottom border. Navigation items are 14px medium; active items get
`bg-neutral-100 text-neutral-900`, inactive `text-neutral-500` with a hover to
`neutral-900`.

### 4.3 Grids

- Dashboard stats: `grid-cols-2 lg:grid-cols-4` with `gap-4`.
- Advertiser portal: `lg:grid-cols-5`, form spans 2, list/analytics span 3.
- Referral stats: `grid-cols-2 sm:grid-cols-4`.
- Analytics: `grid-cols-2 sm:grid-cols-4`.
- Forms: single column, `space-y-4`; paired fields use `grid-cols-2 gap-3`.

### 4.4 Responsive behaviour

- Mobile-first; the shell is usable at 360px.
- Tables are allowed to scroll horizontally on small screens rather than
  collapsing into cards (v0.1 simplification).
- The landing hero uses `text-4xl` on mobile and `sm:text-5xl`.
- Nav remains horizontal; no mobile drawer yet.

---

## 5. Shape, borders, and elevation

| Element | Radius | Border | Shadow |
|---|---|---|---|
| Card | `rounded-xl` (12px) | `1px neutral-200` | none |
| Button / input | `rounded-lg` (8px) | 1px (input/outline) | none |
| Badge | `rounded-full` | none | none |
| Status dot | `rounded-full` | none | none |
| Progress track | `rounded-full` | none | none |
| Extension widget | `10px` | `1px rgba(127,127,127,.25)` | none |
| Extension menu | `8px` | `1px rgba(127,127,127,.35)` | `0 6px 24px rgba(0,0,0,.25)` |

**No drop shadows on cards.** A card is a border and a radius. The only shadow
in the system is the extension's small popover menu, where elevation conveys
layering over host content.

---

## 6. Components

### 6.1 Buttons

Defined in `apps/web/src/index.css` as `@layer components`.

| Class | Appearance | Use |
|---|---|---|
| `.btn-primary` | `bg-neutral-900 text-white hover:bg-neutral-700` | Main action, once per view. |
| `.btn-outline` | Border `neutral-300`, white bg, hover `neutral-50` | Secondary action. |
| `.btn-ghost` | No border, `neutral-600`, hover `neutral-100` | Tertiary/inline action. |
| `.btn` | Shared base | Never used alone in markup. |

Shared behaviour:

- `inline-flex items-center justify-center gap-2`
- `px-4 py-2 text-sm font-medium`
- `rounded-lg`
- `transition-colors`
- `focus-visible:outline-2 outline-offset-2 outline-neutral-900`
- `disabled:pointer-events-none disabled:opacity-50`

Large CTAs add `px-5 py-2.5`. Small/table actions use `text-xs`.

**Rules**

- One primary button per card/section.
- Destructive actions are not styled as primary until a confirmation pattern
  exists.
- Loading labels change in place ("Submitting…", "Uploading…") and disable the
  button.

### 6.2 Inputs and selects

```css
.input {
  width: 100%;
  border-radius: 8px;
  border: 1px solid neutral-300;
  background: white;
  padding: 8px 12px;
  font-size: 14px;
  color: neutral-900;
}
.input::placeholder { color: neutral-400; }
.input:focus { border-color: neutral-900; ring-1 neutral-900; }
```

- Always pair with `.label` (`text-sm font-medium text-neutral-700`, 6px below).
- Required fields use the native `required` attribute.
- Character counters sit in the label as `(n/max)` in `neutral-400`.
- File inputs use a styled `file:` button (`neutral-100` → `neutral-200`).
- Selects reuse `.input` with no custom chevron in v0.1.

### 6.3 Cards

```css
.card      { rounded-xl border neutral-200 bg-white }
.card-pad  { card + p-5 }
```

- Cards group one idea: a stat, a form, a table, a campaign.
- No nested cards. If you need hierarchy inside a card, use a heading and
  spacing, not another bordered box.
- Tables are cards with `overflow-hidden` so the header/rows share the radius.

### 6.4 Badges

```tsx
<Badge tone="good">Verified</Badge>
```

- `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium`
- Always includes a 1.5px status dot.
- Label is short: "Verified", "Early close", "Pending review", "Approved",
  "Rejected", "Auto-approved".
- Never use a badge as a button.

### 6.5 Stats

```tsx
<Stat label="Available" value="$4.20" hint="..." />
```

- Card padding 20px.
- Label: 13px `neutral-500`.
- Value: 24px semibold, tracking-tight, tabular.
- Optional hint: 12px `neutral-400`.
- Values must not wrap awkwardly; money uses 2 or 4 decimals consistently per
  context.

### 6.6 Tables

- Container: `card overflow-hidden`.
- Header row: bottom border, 12px uppercase tracking-wide `neutral-500`.
- Cells: `px-4 py-3`, 14px.
- Rows: dividers `neutral-100`; hover `neutral-50` for interactive rows.
- Numeric columns: tabular, right-aligned where the column is a value.
- Truncate long ad headlines with `max-w-[220px] truncate` and a `title` tooltip
  is a planned improvement.
- Empty state: a full-width row with the `Empty` component (title + optional
  hint), 48px vertical padding.

### 6.7 Empty states

- Centered, 12px vertical padding (48px).
- Title: 14px medium `neutral-600`.
- Hint: 14px `neutral-400`.
- No illustrations, no emoji, no big empty-box graphics.
- Copy should tell the user the next action: "Install the extension and send a
  prompt to any supported AI."

### 6.8 Progress

- Track: 6px tall, `rounded-full`, `bg-neutral-100`.
- Fill: `bg-accent`, width = `min(100, available / threshold * 100)%`,
  `transition-all`.
- Label below: current amount in medium `neutral-700`, threshold in
  `neutral-400`.
- The extension widget has its own 4px progress bar in `currentColor` at 70%
  opacity.

### 6.9 Navigation

- Brand: 24px square, `rounded-md`, `bg-neutral-900`, white lowercase "m",
  15px semibold wordmark.
- Nav links: 14px medium, 6px/12px padding, `rounded-md`.
- Active: `bg-neutral-100 text-neutral-900`.
- Inactive: `text-neutral-500 hover:text-neutral-900`.
- The landing page uses its own top bar with "Sign in" (ghost) and "Get
  started" (primary).

### 6.10 Moderation feedback panel

Used in the advertiser portal after campaign or variant submission:

| Decision | Container | Text |
|---|---|---|
| `auto_approved` | `border-accent/30 bg-accent-soft text-accent` | "Auto-approved by Laya" + score. |
| `needs_review` | `border-amber-300 bg-amber-50 text-amber-800` | "Sent to review by Laya" + score. |
| `auto_rejected` | `border-red-300 bg-red-50 text-red-700` | "Auto-rejected by Laya" + score. |

Reasons are shown as a comma-joined 12px line at 80% opacity. The score is
tabular and right-aligned.

### 6.11 Extension ad widget

The complete CSS lives in `apps/extension/lib/ad-widget.ts` inside a closed
Shadow DOM.

Structure:

```
[Ad · MeanTime] [headline / body] [progress] [✓ Earned] [CTA] [⏸ ×]
```

- Container: flex row, 10px gap, 8px/12px padding, 10px radius, translucent grey.
- Badge: 10px uppercase, letter-spaced, bordered, `rgba(127,127,127,.35)`.
- Headline: 13px semibold, single line, ellipsis.
- Body: 13px, 2-line clamp at 85% opacity.
- Progress: 42px × 4px, `currentColor` at 70%.
- Earned: 11px semibold `#2e9e5b`, hidden until the threshold.
- CTA: 12px semibold, bordered, hover translucent.
- Controls: 13px icon buttons (⏸, ×), hover translucent; the pause menu opens
  below with four options.
- Max width: 640px; margin 6px 0.
- Fade-out: 450ms opacity + 4px translate, then removal.

**Hard rules**

- Never cover the composer or the user's prompt text.
- Never shift layout: mount in the existing action/footer slot where possible.
- Always show the "Ad · MeanTime" label.
- Always show close and pause controls.
- No auto-playing media, no sound, no hover-expanding creative.

### 6.12 Popup

- Fixed 340px width, 16px padding, 13px base text.
- `color-scheme: light dark`; uses system colours and translucent greys.
- Enable toggle: 36×20px pill, green `#2e9e5b` when on.
- Display-mode fieldset: two radio cards with title + explanatory copy; the
  strict mode carries an amber warning note.
- Placement select: full width, 7px/9px padding, 7px radius.
- Stats row: three equal cards (earned, ads cached, pending sync).
- Primary action: full-width "Open earnings dashboard" button.

---

## 7. Motion

- Default transition: `transition-colors` for interactive states.
- Progress fill: `transition-all` for the dashboard; the extension progress bar
  updates via `requestAnimationFrame` only while the ad is actively viewable.
- Widget entrance/exit: 450ms opacity/translate fade.
- Earned confirmation: badge appears; widget fades after 700ms in earned mode.
- No looping animations, parallax, confetti, skeletons, or scroll-triggered
  effects in v0.1.
- Respect the spirit of `prefers-reduced-motion`: the product works without
  animation; the only essential state change is the earned badge/progress.

---

## 8. Accessibility

- All interactive elements are native `<button>`, `<a>`, `<input>`, `<select>`,
  or `<textarea>`.
- Visible focus: 2px `neutral-900` outline with 2px offset on web buttons; the
  `.input` focus ring uses border + ring.
- Buttons that only contain an icon (extension ⏸/×) have a `title` and should
  gain `aria-label` before public release.
- Status is never conveyed by colour alone: badges include text + dot.
- Tables use real `<thead>`/`<tbody>`/`<th>` semantics.
- Form fields are labelled in visible text; placeholders are examples, not
  labels.
- Minimum target size: 32px for icon controls, 36px for buttons.
- The ad label is textual, not an icon-only disclosure.
- The progress bar is decorative; eligibility is also stated in the dashboard.
- The extension menu is keyboard-focusable buttons; a full focus trap is a
  planned improvement.
- The dashboard should add `aria-live` to load/error messages and the earnings
  confirmation in a future pass.

---

## 9. Content and tone

### Voice

- Plain, specific, calm.
- Say the number: "55%", "$5.00", "5 seconds", "75% visible".
- Admit limits: "If the AI answers faster than 5 seconds, the ad closes early
  and will not reach the 5-second payout threshold."
- Never promise guaranteed income.

### UI copy conventions

| Instead of | Write |
|---|---|
| "Oops! Something went wrong :(" | "Failed to load: <reason>" |
| "Click here to withdraw now!!!" | "Request payout" |
| "Free money" | "Earn $0.10 per approved task" |
| "No ads!" (when there are ads) | "Text-only, wait-time ads you control" |
| "Submit" (vague) | "Submit for review", "Create campaign" |

- Sentence case for buttons (`Request payout`, `Create campaign`).
- Use "ad" openly; never disguise sponsored content as editorial.
- Use "pending", "verified", "approved", "rejected", "frozen" consistently with
  API status values.
- Money: `$0.0040` when precision matters, `$4.20` for balances. Durations:
  `5.0s` via `formatMs`.
- Dates use the browser locale via `toLocaleString`/`toLocaleDateString`.

---

## 10. Implementation conventions

### CSS architecture

- Tailwind utility classes in JSX.
- Repeated primitives live in `src/index.css` under `@layer components`
  (`.btn`, `.card`, `.input`, `.badge`, `.dot`).
- Design tokens live in `tailwind.config.js` (font family, accent).
- No CSS modules, styled-components, or inline style objects except dynamic
  values (progress width).
- Use `neutral-*` first; introduce a custom colour only for a semantic role.

### Component conventions

- Small presentational components in `src/lib/ui.tsx`.
- Page-level composition in `src/routes/*.tsx`.
- State is local `useState`/`useEffect` for v0.1; no global store.
- Loading placeholders are em dashes (`—`), not spinners.
- Errors are inline text (`text-sm text-red-600`), not toasts (no toast system).
- Buttons disable during async work and change their label.

### Extension conventions

- Widget styles are a single CSS string inside the Shadow DOM.
- Never rely on host page CSS variables or class names.
- Use `currentColor` and system Canvas colours for dark-mode compatibility.
- Keep the runtime dependency-free (no React in content scripts).
- Prefer `textContent` over `innerHTML` for ad copy.

---

## 11. Do / Don't

| Do | Don't |
|---|---|
| Use one accent colour for success/earned. | Colour every card or heading green. |
| Use borders and spacing to group content. | Add drop shadows or gradients to cards. |
| Show precise money with tabular numerals. | Use proportional digits that jitter. |
| Keep the ad small and dismissible. | Cover the prompt or block the send button. |
| Show a clear "Ad · MeanTime" label. | Hide sponsorship or make it look native. |
| Explain a rejected campaign with the score and reasons. | Show a generic "Error" with no next step. |
| Use sentence case and plain verbs. | Use ALL CAPS, exclamation marks, or urgency. |
| Let the user pause indefinitely. | Re-prompt repeatedly after a dismiss. |
| Fail silent when an ad cannot be mounted. | Show a broken/empty ad container. |

---

## 12. File map

| Concern | File |
|---|---|
| Global base + component classes | `apps/web/src/index.css` |
| Tailwind tokens (font, accent) | `apps/web/tailwind.config.js` |
| Primitives (`Stat`, `Badge`, `Empty`, `Table`) | `apps/web/src/lib/ui.tsx` |
| Shell + nav + page header | `apps/web/src/lib/shell.tsx` |
| Money/duration formatting | `apps/web/src/lib/format.ts` |
| Extension widget CSS + DOM | `apps/extension/lib/ad-widget.ts` |
| Popup markup + CSS | `apps/extension/entrypoints/popup/index.html` |
| Popup logic | `apps/extension/entrypoints/popup/main.ts` |

# Design — Q-Salon Suite

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Because this is a multi-page product, **consistency is the goal, not variety.**
Hallmark's usual diversification rule is inverted here: `/app/*` pages must
share this system, not differ from each other.

## Genre

`modern-minimal` — multi-tenant B2B operational software. Staff open it twenty
times a day; it competes with a paper diary, not with a landing page.

## Macrostructure family

- **App pages** (`/app/*`): **Stat-Led**. Numbers first, everything else
  qualifies them. Variation knobs: which stats, and whether a list or a table
  follows. Do not re-pick a macrostructure per page.
- **Content pages** (`/app/whats-new`, future help//changelog): **Catalogue** —
  a uniform index of items with a status distinction.
- **Public pages** (`/book/*`, marketing): out of scope for this file so far.
  Amend before redesigning them.

## Theme

Custom-tuned, anchored on the brand that already existed. This was **not** a
catalog swap — the palette and type pairing were hand-built for this product
and replacing them would have been a coup, not a redesign.

- `--background` `oklch(0.977 0.006 75)` — Warm Sand
- `--foreground` `oklch(0.29 0.006 260)` — Charcoal
- `--primary` / `--accent` `oklch(0.68 0.075 55)` — Rose Gold
- `--sidebar` `oklch(0.27 0.007 260)` — deep charcoal rail

Axes: **paper band** light (97.7%) · **display style** high-contrast-serif ·
**accent hue** warm (55°).

**Accent discipline.** Rose gold marks exactly three things: the active nav
item's left edge, focus rings, and one primary action per screen. It stays well
under 3% of any viewport. It is never a section background.

## Typography

- Display: **Cormorant Garamond** (500). Roman only — no italic headers, ever.
- Body: **Karla** (300–700).
- `--text-stat` is the Stat-Led hero size and uses `.tnum` tabular figures.
  Any column of numbers compared against another column gets `.tnum`;
  proportional digits make a column of QAR totals visibly ragged.

## Space

4pt scale, `--space-2xs` (4px) → `--space-3xl` (64px). Prefer the token over a
raw Tailwind step so a section can be re-spaced without hunting magic numbers.

## Motion

**Motion-cut project** — no animation library is installed and none is wanted.
Permitted: colour/opacity transitions on hover and focus at `--dur-fast`, and a
1px `active:translate-y-px` press. Forbidden: entrance animations, parallax,
number count-ups, anything animating layout properties.
`prefers-reduced-motion: reduce` collapses all of it (in `src/styles.css`).

Focus rings appear **instantly** — never transition a `:focus-visible` outline.

## Component voice

- **Nav · N3 side-rail.** Dark rail, active item marked by a rose-gold left
  edge plus a raised surface. Below 768px the rail becomes a top bar plus a
  full-height drawer — the rail used to be `hidden md:flex` with no
  alternative, which left mobile with no navigation at all.
- **Footer · Ft2 inline rule.** One hairline, identity or location on the left,
  a single quiet link on the right. No link columns, no social row.
- **Stat cells**: hairline-separated grid (`gap-px` over a border-coloured
  background), not floating cards. A dashboard should read as one instrument.
- **Status**: `--color-status-live` for shipped, `--color-status-upcoming`
  (chromatic-free) for built-but-not-on. These must never share a treatment.

## Copy rules

- No invented metrics, ever. Every number on a screen is computed from the
  database or absent.
- A capability that is not switched on is labelled as such in words, not just
  colour. "Built, not yet switched on" beats a grey badge alone.
- Address staff as colleagues: "Nothing left on the book for today", not
  "No data available".

## Place

The product is built for Qatar, and the grounding is functional rather than
decorative — no flag colours, no motifs.

- **The week starts Sunday.** `weekStartsOn: 0` is pinned explicitly wherever a
  week is computed. An unpinned Monday default would silently misreport every
  weekly revenue figure on the platform.
- Currency via `Intl.NumberFormat("en-QA", { style: "currency" })`, never
  string concatenation.
- Client- and service-name fields carry `dir="auto"` so Arabic data renders
  correctly beside English chrome.

## Accessibility floor

- Every interactive element ships `:focus-visible` at ≥3:1 contrast.
- Icons that repeat an adjacent text label are `aria-hidden`.
- No two-line clickable text — nav items and buttons use `whitespace-nowrap`.
- Verified at 320 / 375 / 414 / 768px.

## Exports

`tokens.css` at the project root is the portable export. The app does **not**
import it — `src/styles.css` is the live source of truth, because Tailwind v4
needs the tokens inside its own `@theme inline` block. Keep the two in step.

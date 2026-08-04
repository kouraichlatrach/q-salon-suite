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
- **Marketing pages** (`/`, future pricing//about): **Narrative Workflow**.
  Numbered stages describe what happens in the salon, in order. The audience
  does not know the product yet, so the page answers "what happens in my
  salon", not "what features does it have". Variation knobs: how many stages,
  and which proof section follows. A feature grid is specifically *not* the
  shape here — the previous landing page was one, and it had to invent a
  metric to fill a tile.
- **Booking pages** (`/book/*`, `/manage/*`): still out of scope for this
  file. Amend before redesigning them.

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

On a **marketing page** the primary action legitimately repeats — in the nav,
in the hero, and once at the foot — since a visitor may decide at any of the
three. That is the only widening: still button fill and focus rings, still
never a fill behind a section. The old landing page used rose gold as a
full-bleed panel behind a fabricated revenue figure, which broke both halves
of this rule at once.

## Typography

- Display: **Cormorant Garamond** (500). Roman only — no italic headers, ever.
- Body: **Karla** (300–700).
- `--text-stat` is the Stat-Led hero size and uses `.tnum` tabular figures.
  Any column of numbers compared against another column gets `.tnum`;
  proportional digits make a column of QAR totals visibly ragged.
- `--text-hero` exists for **marketing pages only**. App pages must not reach
  for it — `--text-display` is already the largest thing staff should meet
  twenty times a day.
- A figure is never allowed to wrap. `overflow-wrap: anywhere` is set globally
  on display type (correct for a long salon name in a heading, wrong for a
  numeral), so every stat, count and price carries `[overflow-wrap:normal]`.

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

- **Nav · N3 side-rail** (app pages). Dark rail, active item marked by a
  rose-gold left edge plus a raised surface. Below 768px the rail becomes a top
  bar plus a full-height drawer — the rail used to be `hidden md:flex` with no
  alternative, which left mobile with no navigation at all.
- **Nav · N9 edge-aligned** (marketing pages). Wordmark hard-left, sign-in plus
  one primary action hard-right, and *nothing between them*. Filling that space
  with a four-link row is the most recognisable templated marketing bar there
  is; the page's own numbered stages do the navigating instead. It also needs
  no hamburger, because there is no link row to hide.
- **Footer · Ft2 inline rule** (app pages). One hairline, identity or location
  on the left, a single quiet link on the right. No link columns, no social row.
- **Footer · Ft1 mast-headed** (marketing pages). One band: wordmark, one line
  saying what the product is, two quiet links, year. Still not four columns.
- **Stat cells**: hairline-separated grid (`gap-px` over a border-coloured
  background), not floating cards. A dashboard should read as one instrument.
- **Status**: `--color-status-live` for shipped, `--color-status-upcoming`
  (chromatic-free) for built-but-not-on. These must never share a treatment.

## Copy rules

- No invented metrics, ever. Every number on a screen is computed from the
  database or absent.
- A capability that is not switched on is labelled as such in words, not just
  colour. "Built, not yet switched on" beats a grey badge alone. **This rule
  does not soften on the marketing page** — the same split is shown to a
  prospect, from the same source (`src/lib/capabilities.ts`), so the two
  surfaces can never disagree about what runs.
- Address staff as colleagues: "Nothing left on the book for today", not
  "No data available".
- **Marketing copy carries no invented proof.** No customer counts, no logo
  wall, no testimonials, no growth percentages — there are no customers to
  cite yet, and a buyer who checks one fabricated claim stops believing the
  true ones. Credibility comes from checkable specifics instead (currency, week
  start, where the data sits, what the database refuses).
- **A number the product enforces has exactly one home.** Plan limits and
  prices render from `src/lib/plan-limits.ts`, never retyped into a page. The
  previous landing page quoted 5 and 20 staff seats against real limits of 3
  and 10, so a buyer would have hit a wall two seats early.

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

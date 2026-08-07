# Design — Q-Salon Suite

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Because this is a multi-page product, **consistency is the goal, not variety.**
Hallmark's usual diversification rule is inverted here: `/app/*` pages must
share this system, not differ from each other.

## Genre

Two genres, split by audience. They share every token; they differ in warmth.

- **App and content pages · `modern-minimal`.** Multi-tenant B2B operational
  software. Staff open it twenty times a day; it competes with a paper diary,
  not with a landing page.
- **Marketing pages · `atmospheric`.** A salon owner meets this once, cold, and
  decides on feel before they decide on features. Enterprise-documentation
  restraint reads as cold here, which is the opposite of the business being
  sold.

**Atmospheric runs as the light-paper (Bloom) exception, not its dark default.**
Its usual dark canvas and Geist-sans voice are both refused: the theme below is
locked, and a marketing page wearing a different palette from the product is a
different product. What atmospheric actually grants here is warmth — soft
radial blooms on the canvas, a larger and more expressive display size, and
fade-only motion. Nothing about colour or type changes.

## Macrostructure family

- **App pages** (`/app/*`): **Stat-Led**. Numbers first, everything else
  qualifies them. Variation knobs: which stats, and whether a list or a table
  follows. Do not re-pick a macrostructure per page.
- **Content pages** (`/app/whats-new`, future help//changelog): **Catalogue** —
  a uniform index of items with a status distinction.
- **Marketing pages** (`/`, future pricing//about): **Split Studio**. Alternating
  diptychs, each pairing one outcome the owner wants with one piece of proof
  that it happens. Variation knobs: how many blocks, which side leads, and
  whether the proof is a photograph or a list.

  Two shapes have already been tried and rejected here, so don't return to
  them: a **feature grid** (the original) had to invent a metric to fill a
  tile, and **Narrative Workflow** — numbered stages, `01`–`04` — was accurate
  but read as documentation, explaining mechanics to someone who had not yet
  been given a reason to care. Split Studio leads with the reason and lets the
  mechanism follow inside the same block.

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

**App and content pages stay motion-cut.** No animation library is installed
and none is wanted there. Permitted: colour/opacity transitions on hover and
focus at `--dur-fast`, and a 1px `active:translate-y-px` press. Forbidden:
entrance animations, parallax, number count-ups, anything animating layout
properties. Staff meet these screens twenty times a day, and an entrance
animation on the twentieth visit is an obstacle, not delight.

**Marketing pages are an explicit exception.** A visitor meets `/` once, and a
page that arrives completely inert reads as unfinished. Motion is allowed
there, bounded to two moments:

1. **One orchestrated hero entrance.** Opacity only, staggered across the
   headline, lede, actions and image, ~500ms end to end, once on load.
2. **One reveal per outcome block**, fired on first intersection and then
   disconnected — never re-triggering, never on every section.

Everything else on a marketing page is static. The named failure this bounds is
_fade-everything-on-scroll_: when every section animates in, none of them read
as deliberate and the page never settles. Fade only — no slide, no scale, no
parallax, no bounce or overshoot easing, and nothing scroll-linked to a
scrubbing position.

Both surfaces collapse under `prefers-reduced-motion: reduce`, which is
enforced globally in `src/styles.css` and additionally honoured in the reveal
script, so a reduced-motion visitor gets fully-visible content rather than
content waiting on an observer that never fires.

Focus rings appear **instantly** — never transition a `:focus-visible` outline.

## Component voice

- **Nav · N3 side-rail** (app pages). Dark rail, active item marked by a
  rose-gold left edge plus a raised surface. Below 768px the rail becomes a top
  bar plus a full-height drawer — the rail used to be `hidden md:flex` with no
  alternative, which left mobile with no navigation at all.
- **Nav · N5 floating pill** (marketing pages). A rounded bar visibly detached
  from the page edges over a blurred backdrop — the warm, contemporary register
  atmospheric asks for. It carries the wordmark and one primary action only; a
  four-or-five-link marketing bar is the most recognisable templated shape
  there is, and no hamburger is needed because there is no link row to hide.
- **Footer · Ft2 inline rule** (app pages). One hairline, identity or location
  on the left, a single quiet link on the right. No link columns, no social row.
- **Footer · Ft5 statement** (marketing pages). One display sentence closes the
  page — a closing line, not a sitemap — with the wordmark, two quiet links and
  the year set small beneath it. Never four columns of links.
- **Stat cells**: hairline-separated grid (`gap-px` over a border-coloured
  background), not floating cards. A dashboard should read as one instrument.
- **Status**: `--color-status-live` for shipped, `--color-status-upcoming`
  (chromatic-free) for built-but-not-on. These must never share a treatment.

## Data visualisation

Charts are an app-page concern only (`/app/reports`, and any future analytics).
Marketing pages carry no charts — an invented figure in a chart is the same
fabricated-proof failure as an invented metric in copy, and harder to spot.

**Series colour is a separate ramp from the accent, deliberately.** Rose gold is
capped under 3% of the viewport and reserved for the nav edge, focus rings and
one primary action. A chart fills large areas by definition, so painting series
in rose gold would break accent discipline on the one screen where the accent
still has to mean "act here". The five categorical steps live as `--chart-1`
… `--chart-5` in `src/styles.css`, with separate values under `.dark`.

- **The ramp is validated, not eyeballed.** All five steps pass a six-check
  audit against the surface they sit on: lightness band, chroma floor,
  adjacent-pair colour-vision separation, normal-vision separation, and 3:1
  contrast. Worst adjacent pair is 11.4 ΔE (deutan) in light, 12.1 in dark.
- **Dark mode gets its own steps.** The dark lightness band (L 0.48–0.67) is
  narrower and lower than the light band (0.43–0.77), so flipping the light
  values fails the audit outright. Re-run the validator after any edit — do not
  hand-tune a step and assume.
- **Assign in fixed order, never cycled.** A sixth series folds into "Other" or
  becomes small multiples. A generated sixth hue is not permitted.
- **Never a dual-axis chart.** Two measures of different scale get two stacked
  plots on a shared x-axis. Overlaying revenue and appointment counts on two
  y-axes invents a correlation out of arbitrary axis alignment.
- **Colour is never the only carrier of identity.** Every series is directly
  labelled or legended; text stays in the ink tokens and never takes the series
  colour.
- **Recharts gets resolved colour strings, not `var()`.** Recharts writes
  colours as SVG presentation attributes, where `var()` is not reliably
  resolved. `useChartPalette()` reads the custom properties and hands over
  concrete values. The pre-redesign Reports page painted every mark
  `hsl(var(--accent))` against an `oklch()` token — not a colour at all — and
  nobody noticed, which is exactly why this rule is written down.

**Every rate ships its denominator.** A percentage computed on a handful of
records is noise wearing the costume of a finding. Rates below five concluded
records render as raw counts with a note, never as a headline percentage —
"100% no-show" beside a staff member's name off a single appointment is a
number that damages someone.

**Say which clock a figure is on.** Revenue is counted when money was collected;
appointment volume, no-shows and cancellations are counted by the visit date.
Those are different populations and must never be divided into one another. Any
card mixing them states its basis in the hint line.

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
- **Marketing copy leads with the outcome and then names the mechanism that
  delivers it.** "Sell the result, explain the cause" is the shape; a page that
  only describes mechanics is accurate and unpersuasive, which was the failure
  of the numbered-stages draft.
- **Every promised outcome must trace to a capability that is actually live.**
  This is the rule that keeps persuasion honest, and it has one standing trap:
  fewer no-shows may be attributed **only to deposits**, which ship today —
  never to WhatsApp reminders, which are built but not sending. The warmer the
  copy gets, the easier it is to reach for the reminder story; don't.
- **Honesty content is never deleted to make room for the pitch — it moves.**
  The full capability split, the plan limits and the operational facts all stay
  on the page, below the persuasion rather than competing with it. "Smaller and
  later" is an acceptable edit; "gone" is not.

## Imagery

Marketing pages may carry photography. App pages may not — function carries
those, and decoration on a working screen is noise.

- **Real photographs only.** Never a drawn or CSS-built imitation of a UI, a
  browser frame, a phone, or a dashboard. The product's own screens are shown
  as real screenshots or not at all.
- **Nothing identifiable that we have no relationship with.** No third-party
  business name, signage, or branded hardware in frame. A photo carrying
  another company's logo reads as a customer logo or an endorsement, which is
  the invented-proof rule wearing a different hat. Candidates have already been
  rejected for exactly this: a salon shot with a competitor's payment terminal
  and logo as its subject, and an interior whose wall carried a real salon's
  name (kept, but only after cropping the signage out).
- **Interiors and details over people.** A visibly Western salon team on a page
  selling to Doha reads as imported, and undercuts the local credibility the
  page is built on. Rooms, surfaces and light make no claim about whose salon
  it is. Dress and setting must not be culturally jarring for a Gulf audience —
  one otherwise-good candidate was rejected on this alone.
- **Warmth must match the palette.** Cool or blue-cast photography fights Warm
  Sand and Rose Gold; a barbershop lit with blue LEDs was rejected for it.
- **Stock is a placeholder and is labelled as one in the source.** Every stock
  image carries a comment naming its licence and stating it should be replaced
  with photography of a real client salon. Stock that isn't marked as temporary
  quietly becomes permanent.

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

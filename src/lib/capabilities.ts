/**
 * The single inventory of what this product can do — and what it can't yet.
 *
 * This list is read by two audiences with opposite starting points: staff who
 * already use the suite (`/app/whats-new`) and salon owners deciding whether to
 * buy it (`/`). They need different *prose*, so each page writes its own; what
 * they must never disagree on is the inventory itself, and above all the split
 * between the two arrays.
 *
 * That split is the whole point. A marketing page that quietly promotes an
 * UPCOMING item into the live list is the exact failure this file prevents: the
 * owner signs up expecting WhatsApp reminders to go out, stops phoning clients,
 * and nobody finds out until a chair sits empty. Moving an entry between these
 * two arrays is a product decision, not a copy edit — make it here, once, and
 * both pages follow.
 */

export type Capability = {
  /** Audience-neutral. Safe to render to a prospect or to a receptionist. */
  title: string;
  /** Written for staff who are already inside the product. */
  detail: string;
};

/** Working today. Nothing in this list is a promise. */
export const LIVE: Capability[] = [
  {
    title: "Multi-location management",
    detail:
      "One brand, many locations. Staff, stock and reporting stay scoped to the branch they belong to. Unlimited locations on Enterprise.",
  },
  {
    title: "Four role levels",
    detail:
      "Owner, Manager, Receptionist and Staff. Each sees only what their role needs — a technician sees their own day, not the salon's revenue.",
  },
  {
    title: "Appointments",
    detail:
      "Double-booking is blocked at the database, not just the screen. Staff working hours and approved leave are respected when offering a slot.",
  },
  {
    title: "Client records",
    detail:
      "Profiles are shared across the whole brand, so a client is the same person at every branch. Visit history, per-visit service notes and no-show count travel with them.",
  },
  {
    title: "Stock and inventory",
    detail:
      "One product catalogue, quantities tracked per location. Completing a service deducts what it used automatically.",
  },
  {
    title: "Services and pricing",
    detail:
      "A shared service catalogue with per-location price overrides that only an Owner can set.",
  },
  {
    title: "Self-booking portal",
    detail:
      "A public booking page per brand, with phone verification and live availability computed from real staff schedules.",
  },
  {
    title: "Booking deposits",
    detail:
      "Per service, flat or percentage, optional or required. Cancellations inside the window are refunded automatically.",
  },
  {
    title: "Gift cards",
    detail:
      "Sold at the counter, redeemable in parts across several visits until the balance runs out.",
  },
  {
    title: "Packages",
    detail:
      "Prepaid bundles of several services. At checkout the system spots a client's remaining sessions and offers to use one.",
  },
  {
    title: "Reports",
    detail: "Revenue, stock and staff performance — scoped to what your role is allowed to see.",
  },
  {
    title: "Built for Qatar",
    detail:
      "QAR throughout, Arabic-capable client and service fields, and a week that starts on Sunday like the working week does.",
  },
];

/** Built, but not switched on. Never render these alongside LIVE unmarked. */
export const UPCOMING: Capability[] = [
  {
    title: "WhatsApp confirmations and reminders",
    detail:
      "Consent capture, opt-out and scheduling are built and working. The messages themselves are waiting on an upgraded WhatsApp Business account — until that lands, nothing is sent.",
  },
  {
    title: "In-salon digital checkout",
    detail:
      "Charging a client by QR code or a WhatsApp payment link, instead of logging the payment by hand.",
  },
  {
    title: "Memberships",
    detail:
      "Recurring client subscriptions — a monthly fee for a discount or a set of included services.",
  },
];

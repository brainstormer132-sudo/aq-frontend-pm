# AQ Creativity — internal platform

The system AQ Creativity runs its campaigns on: sales bookings, vendor and
client contracts, delivery tracking, invoicing, and the legal register that
holds the paperwork. Next.js 16 and Supabase, one workspace, nine roles.

It is not a general project-management tool. Every screen is shaped around a
campaign: a client buys a campaign, vendors (usually influencers) are booked
onto it as bookings, each booking holds ad lines, each ad line is a post that
has to go out, be proved, and be paid for.

---

## The shape of it

**Two Postgres schemas.**

- `public` — campaigns (`pm_tasks`, parents and their bookings), ad lines,
  clients, vendors, bank accounts, tracking sheets, CRM, finance.
- `legal` — templates, their versions and blocks, contracts, contract field
  values, the register, signatures. Readable only by owner, admin and legal;
  everything operations needs from it comes through `security definer`
  functions that return status, never field values.

**Three front doors.** `/portals` chooses between them.

- `/auth` → the internal app (the sidebar: Overview, Work, Contacts,
  Delivery, Money, Legal, Admin).
- `/vendor/*` → the vendor portal.
- `/client/*` → the client portal.

**One external dependency.** The vendor and client portals, and seven internal
screens, call a FastAPI service on Render through the `/contracts/api/*`
rewrite in `vercel.json` (`lib/portal-api.ts`, `lib/contract-api.ts`). If that
rewrite does not travel with the Vercel project, both portals stop working.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

| script | what it does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | production build |
| `npm test` | the pure-logic suite (no framework, no watch mode) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:test` | replays every migration into an empty Postgres and asserts the security properties |
| `npm run lint` | Next lint |

**Environment.** In `.env.local` locally, and in the Vercel project for
deployments:

| variable | where | why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser | Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | team invites and member removal. Never prefix it `NEXT_PUBLIC_` |
| `CRON_SECRET` | server only | authenticates the scheduled routes below |
| `ASANA_PAT`, `ASANA_WORKSPACE_ID`, `ASANA_PROJECT_GID` | server only | the Asana sync |
| `NEXT_PUBLIC_CONTRACT_API_URL` | dev only | the FastAPI service when not behind the Vercel rewrite |
| `SUPABASE_DB_URL` / `PGURL` | local only | `npm run db:test` |

---

## The database

`supabase/migrations/000_baseline.sql` is a dump of the live schema at the
point the numbered migrations start. Everything after it is numbered and
applied in order, by hand, in the Supabase SQL editor.

Each migration carries three things: a comment explaining **why**, a
self-test (`do $$ ... $$`) that proves what it claims and rolls back, and a
commented-out verify query at the foot to paste afterwards. A migration whose
self-test cannot tell whether the code is right — because the answer depends
on who ran it — asserts the structural fact instead. That rule was written
after one that tested the person rather than the code.

`supabase/migrations/archive/` holds one-off scripts that were applied once:
seeds, a template port, a removal. They are history, not migrations.

---

## Tests

`npm test` compiles the pure modules in `lib/` with bare `tsc` and runs plain
`.mjs` suites over them. No framework. ~2,960 assertions across 53 suites,
and CI runs typecheck, tests, and the migration replay on every push.

The rule the suite is built on: **decisions live in `lib/`, pure, and screens
read them.** A readiness check inside a component can only be exercised by
clicking. Anything that decides whether money is owed, whether a contract can
be issued, or what a person is allowed to do belongs in a tested module.

---

## Where things are

```
app/                    routes only - the internal app, the two portals, api routes
  api/                  Next route handlers: asana sync, contract chase,
                        payments due, registry expiry, team admin
components/workflow/    the internal screens
  campaign/             one campaign: bookings, vendor contracts, paperwork
  legal/                the register, templates, contract fill, signatures
components/portal/      the vendor and client portals
hooks/use-workflow.ts   campaigns, bookings, vendors, clients, money
hooks/use-legal.ts      templates, contracts, the register
lib/                    the decisions, pure and tested
scripts/run-tests.mjs   the test runner
supabase/migrations/    000_baseline.sql, then numbered, in order
```

---

## Deployment

Vercel, auto-deploying from `main`. `vercel.json` carries:

- the `/contracts/api/*` rewrite to the FastAPI service,
- `/portals` and `/invite`, which serve the two static pages in `public/`,
- four cron schedules that hit the route handlers in `app/api/`.

`.github/workflows/ci.yml` runs the checks.

There used to be a `keep-backend-warm.yml` beside it, pinging the FastAPI
service every ten minutes through the working day so the first request did not
pay Render's ~30-60s cold start. It is gone: the Render service is moving to a
paid instance type, which does not spin down, so there is nothing to keep warm.
It was also about to become expensive - it lived here because a public repo has
unlimited Actions minutes, and a private one has 2,000 a month, which that
workflow would have spent in under a week.

---

## Conventions worth knowing before changing anything

- **PostgREST caps a select at 1000 rows, silently.** Any list read that can
  grow uses `selectAllRows` with a total order (`created_at, id` - not
  `created_at` alone, which is not unique after an import writes hundreds in
  the same second).
- **An update that matches nothing is a success in PostgREST.** Anything that
  must have changed a row asks for it back with `.select()` and says so when
  it did not.
- **A contract is sealed at issue.** Its field values freeze and a fingerprint
  covers the version and the values. Anything printed on the page but outside
  that seal - the number, the supersede notice, the approval - is deliberate,
  and adding one of them to the seal would make every contract already issued
  verify as "differs".
- **Every rule can be passed.** A rule that stops somebody records who passed
  it and why (`public.rule_override`), because prevention is not what a rule
  buys - a record is.
- **Money owed means completed work only.** Collection and liability hold
  done campaigns; running work stays in the profitability figures.

---

Private. © AQ Creativity.

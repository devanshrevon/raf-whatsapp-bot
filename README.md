# Raf — WhatsApp Debt-Support Callback Bot

Implementation of the simplified developer spec: a WhatsApp conversation bot
that collects basic lead information, books a real callback on Google
Calendar, and shows leads to Raf's team. One Next.js app, one Postgres
database, no Redis/BullMQ/separate worker.

## Status: Phase 1 complete (Application foundation)

What's built and working right now:

- Next.js 14 (App Router) + TypeScript + Tailwind project, deployable to Railway as-is.
- Prisma schema with the five tables from spec section 8 (`leads`, `messages`, `appointments`, `scheduled_actions`, `system_events`), including all enums.
- Single protected login (bcrypt password check + signed JWT session cookie), middleware-gated.
- Screen 1 — Leads list, Screen 2 — Lead detail (transcript, collected fields, vulnerability banner, appointment, follow-up status), Screen 3 — Appointments (today / upcoming / missed / completed).
- Working actions on Screen 2: pause/resume bot, mark no answer, mark completed, stop messages — these are plain database state changes with the correct side effects (cancelling pending follow-ups, creating a `MISSED_CALLBACK` scheduled action, logging a `system_events` row).
- REST routes from spec section 25: `GET /api/health`, `GET/PATCH /api/leads`, `GET/PATCH /api/appointments`, plus stubs for `/api/twilio/inbound`, `/api/twilio/status`, and `/api/internal/process-scheduled-actions` (the last one's secret-header auth is real; the processing logic is Phase 5).
- Full `lib/` folder structure from spec section 24, with each not-yet-built file containing a comment pointing at the spec section it implements, so nothing is guessed at later.

What's intentionally **not** built yet, by phase (spec section 28):

| Phase | Covers | Key files |
|---|---|---|
| 2 | Twilio WhatsApp webhook, signature verification, dedup | `lib/twilio/*`, `app/api/twilio/*` |
| 3 | OpenAI conversation engine, fact extraction, missing-field logic | `lib/ai/*`, `lib/conversation/*` |
| 4 | Google Calendar availability + booking | `lib/calendar/*` |
| 5 | Follow-up cron processing | `lib/scheduled-actions/process.ts` |
| 6 | Opt-out detection, guardrails, vulnerability handling | `lib/safety/*` |

The "Book / reschedule callback" button on Screen 2 is visibly disabled until
Phase 4, rather than faking a booking — the spec is explicit that the bot
must never confirm an appointment before Google Calendar does.

## One thing to flag before Phase 2 starts

This sandbox couldn't reach `binaries.prisma.sh` to download the Prisma
query engine, so `prisma generate` hasn't been run against this schema yet
(everything above was reviewed by hand against the schema field-by-field).
Run the setup steps below on your machine / Railway, where that domain is
reachable — `npm run typecheck` should come back clean once it runs.

## Setup

```bash
cp .env.example .env
# fill in DATABASE_URL (Railway provisions this when you add a Postgres service),
# SESSION_SECRET (openssl rand -base64 32), ADMIN_USERNAME, and ADMIN_PASSWORD_HASH:
node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"

npm install
npx prisma migrate dev --name init
npm run dev
```

Visit `http://localhost:3000`, sign in, and you'll land on an empty Leads
screen — that's expected until Phase 2 starts feeding it real conversations.

## Deploy (Railway)

Same workflow as your other Railway projects:

```bash
npx tsc
git add .
git commit -m "<message>"
git push origin main
```

Railway auto-deploys on push. Add a Postgres service to the same project so
`DATABASE_URL` is provisioned automatically, then set the remaining vars from
`.env.example` in the service's Variables tab. After the first deploy, run
`npx prisma migrate deploy` against the Railway database (via `railway run`
or a one-off shell) to create the tables.

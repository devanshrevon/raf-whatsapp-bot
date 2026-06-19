# Raf WhatsApp Debt-Support Bot — Handbook

A single place that explains what this project is, how it works, how to run and
deploy it, how Raf's team uses the dashboard, and what to do when something
breaks. Keep it up to date as the system changes.

---

## 1. What this is (in one paragraph)

People in the UK who are struggling with debt message a WhatsApp number. An AI
assistant has a short, natural conversation with them, collects the minimum
information Raf's team needs, answers a few approved questions, and books a real
callback on Google Calendar. Raf's team sees every lead in an internal dashboard
and phones the customer back. It is **not** a debt-advice service — it is a
lead-engagement and callback-booking system. Real advice happens on the human
call.

---

## 2. How it works (the journey)

```
Customer sends a WhatsApp message
        │
        ▼
Twilio receives it → forwards to our webhook (/api/twilio/inbound)
        │
        ▼
We verify it's really Twilio → ignore duplicates → find/create the lead
        │
        ▼
Opt-out check ("stop") → if opted out, confirm + stop. Otherwise…
        │
        ▼
OpenAI reads the message → extracts facts (debt, region, etc.) + risk level
        │
        ▼
Our code (not the AI) decides the next step and validates the reply
        │
        ▼
Reply sent back via Twilio → stored in the database
        │
        ▼
When enough is known → bot offers REAL calendar slots → books the callback
        │
        ▼
Lead + transcript + appointment appear in the dashboard → team calls back
```

Background: a **cron** job runs every ~10 minutes and sends follow-ups (gentle
nudges if the customer goes quiet, appointment reminders, missed-call messages).

---

## 3. Tech stack

| Area | Choice |
|---|---|
| App | Next.js 14 (App Router, TypeScript) — one app serves both the dashboard UI **and** the API |
| Database | PostgreSQL (Prisma ORM) |
| WhatsApp | Twilio WhatsApp API |
| AI | OpenAI API |
| Calendar | Google Calendar API |
| Styling | Tailwind CSS |
| Validation | Zod |
| Auth | Single shared login (bcrypt password + signed JWT cookie via `jose`) |
| Hosting | Railway — one project: the app + a Postgres service + a cron service |
| Tests | Vitest |

There is **no** Redis, BullMQ, separate worker, microservices, or multi-tenant
setup — by design (per the spec).

---

## 4. Repository structure

```
app/
  (dashboard)/         Protected screens (require login)
    leads/             Screen 1: leads list
    leads/[id]/        Screen 2: lead detail (+ server actions in actions.ts)
    appointments/      Screen 3: appointments (today/upcoming/missed/completed)
  api/
    twilio/inbound/    Inbound WhatsApp webhook (the heart of the bot)
    twilio/status/     Delivery-status callback
    internal/process-scheduled-actions/   Cron endpoint (follow-ups)
    leads/ appointments/ health/          Dashboard + health APIs
  login/               Single shared login
lib/
  ai/                  OpenAI client, response schema, system prompt, reply validation, orchestrator
  conversation/        Field definitions, known/missing fields, fact-merge, state machine, FAQ
  calendar/            Timezone, slot calc, Google I/O, booking, conversational booking
  safety/              Opt-out detection, vulnerability classification, prohibited-claim guardrails
  scheduled-actions/   Follow-up cron processor
  leads/ appointments/ Shared dashboard mutations
  auth/ db.ts env.ts format.ts
prisma/schema.prisma   The 5 tables
prompts/               Versioned system prompt (human-readable mirror)
tests/                 Unit + conversation tests
```

---

## 5. Environment variables

Set these in each Railway service's **Variables** tab. Never prefix anything with
`NEXT_PUBLIC_` (that exposes it to the browser). Full template lives in
`.env.example`.

### App service (`raf-whatsapp-bot`)
| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection (Railway provides it; reference `${{Postgres.DATABASE_URL}}`) |
| `SESSION_SECRET` | Signs the dashboard login cookie (`openssl rand -base64 32`) |
| `ADMIN_USERNAME` | Dashboard login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the password — **not** the plain password |
| `INTERNAL_CRON_SECRET` | Shared secret protecting the cron endpoint |
| `APP_VERSION` | Stamped on outbound AI messages for tracing |
| `APP_BASE_URL` | Public app URL (used in calendar event links) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_WHATSAPP_NUMBER` | Sender, e.g. `whatsapp:+14155238886` (sandbox) |
| `TWILIO_WEBHOOK_BASE_URL` | Optional — only if the public webhook URL differs from the request host |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI key + model (e.g. `gpt-4o`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Long-lived token from the OAuth Playground |
| `GOOGLE_REDIRECT_URI` | `https://developers.google.com/oauthplayground` |
| `GOOGLE_CALENDAR_ID` | `primary` or a specific calendar id |

### Cron service (`cron`)
| Variable | Value |
|---|---|
| `APP_URL` | The app's public URL |
| `INTERNAL_CRON_SECRET` | **Must exactly match** the app service's value |

Generate the login password hash locally:
```bash
node -e "console.log(require('bcryptjs').hashSync('your-password', 10))"
```

---

## 6. Database — five tables

| Table | Holds |
|---|---|
| `Lead` | The customer: contact, collected debt/situation fields, status, consent/opt-out/pause flags, vulnerability level + flags, follow-up count |
| `Message` | Every WhatsApp message in/out, sender type, Twilio SID (deduped on this), extracted data |
| `Appointment` | Callback bookings, linked to a Google Calendar event id, status |
| `ScheduledAction` | Queue for the three follow-up types, with attempt count + retry/fail |
| `SystemEvent` | Audit log: opt-outs, pauses, bookings, follow-ups sent, safeguarding flags, API failures |

**Lead statuses:** `ACTIVE`, `BOOKED`, `MISSED`, `NEEDS_REVIEW`, `COMPLETED`, `STOPPED`.

Migrations live in `prisma/migrations/`. Railway applies them on deploy via the
pre-deploy command `npx prisma migrate deploy`.

---

## 7. The conversation engine (important)

Golden rule: **the application controls the flow, the AI only words things.**

- OpenAI is called once per customer message and must return a structured JSON
  object (validated by Zod in `lib/ai/schema.ts`): intent, extracted facts,
  corrections, customer question, risk level, and a proposed reply.
- Our state machine (`lib/conversation/determine-next-action.ts`) decides what
  to ask next, based on which required fields are still missing — it never
  re-asks something already known.
- The reply is validated (`lib/ai/validate-reply.ts`): length, one question at a
  time, no prohibited claims, no re-asking known facts. If it fails, a safe
  fallback message is used.
- If OpenAI fails or returns invalid JSON, the bot still sends a sensible
  templated question — it never crashes the conversation.

The AI is **never** allowed to: invent calendar availability, confirm a booking,
decide opt-out, promise debt write-off, recommend a product, or pretend to be
human.

---

## 8. Calendar booking

- All times are **Europe/London** (BST/GMT handled correctly).
- The bot only ever offers **real** free slots pulled from Google Calendar
  free/busy — it never makes times up.
- Calling hours: **9am–6pm UK**, 30-minute slots.
- Before booking, the slot is re-checked. The Google event is created **first**;
  only if that succeeds is the DB appointment written. A failed booking is never
  confirmed to the customer.
- The team can also book/reschedule manually from the lead detail screen.

---

## 9. Follow-ups & the cron

Three follow-up types (`lib/scheduled-actions/process.ts`):
1. `INCOMPLETE_CONVERSATION` — customer went quiet mid-chat.
2. `APPOINTMENT_REMINDER` — before a booked callback.
3. `MISSED_CALLBACK` — team marked the call as missed.

A separate Railway **cron service** calls
`POST /api/internal/process-scheduled-actions` every ~10 minutes with the header
`x-internal-secret: <INTERNAL_CRON_SECRET>`. Each tick: claim due actions, check
guards (opted out? paused? completed? already replied? vulnerable?), send the
message, mark done. Failures retry (5 min, 15 min) then mark `FAILED`.

Follow-ups are automatically paused for serious/vulnerable cases and cancelled on
opt-out or completion.

---

## 10. Safety

- **Opt-out** (`lib/safety/opt-out.ts`): phrases like "stop", "unsubscribe",
  "leave me alone" are caught **before** the AI is called. The lead is set to
  STOPPED/opted-out, pending follow-ups cancelled, one confirmation sent.
- **Vulnerability** (`lib/safety/vulnerability.ts`): messages are scored
  Level 0–3 (suicidal/abuse/urgent bailiff = high). Level 2+ stops the ordinary
  sales-style questions, flags the lead `NEEDS_REVIEW`, shows a dashboard
  warning, and sends only a neutral holding reply.
- **Guardrails** (`lib/safety/guardrails.ts`): blocks prohibited claims
  (guarantees, write-offs, product recommendations, requests for card details).

> ⚠️ **Before launch:** the exact safeguarding / emergency wording must be
> approved by Raf. The current hold message is a neutral placeholder — do not
> invent medical, legal, or emergency instructions.

---

## 11. Dashboard guide (for Raf's team)

Log in at `/login`. Three screens:

- **Leads** — everyone who's messaged: name, phone, status, last message time,
  next callback, and a "Needs review" flag for vulnerable cases. Click a row to
  open the lead.
- **Lead detail** — the full picture: information collected, the entire WhatsApp
  transcript, the appointment, follow-up status, and a vulnerability banner when
  relevant. Actions:
  - **Pause / Resume bot** — temporarily stop the bot replying.
  - **Book / reschedule** — pick a date + time (9am–6pm) and book a callback.
  - **Mark no answer** — couldn't reach them; queues a reschedule message.
  - **Mark completed** — call done; stops all follow-ups.
  - **Stop messages** — opt the customer out of all messages.
  - **Reactivate lead** — undo a stop (only if the customer asks to resume).
- **Appointments** — callbacks grouped into Today / Upcoming / Missed /
  Completed. Click any row to open the lead.

---

## 12. Local development

```bash
git clone https://github.com/devanshrevon/raf-whatsapp-bot
cd raf-whatsapp-bot
cp .env.example .env          # fill in values
npm install
npx prisma migrate dev        # against a local/dev Postgres
npm run dev                   # http://localhost:3000
```

Useful scripts:
```bash
npm run test        # vitest
npm run typecheck   # tsc --noEmit
npm run build       # prisma generate + next build
```

---

## 13. Deployment (Railway)

One project, three services:
1. **`raf-whatsapp-bot`** (the app) — deploys from GitHub `main` on push.
   - Pre-deploy command: `npx prisma migrate deploy`
   - Networking → Generate Domain (port 3000)
   - Set all app env vars.
2. **Postgres** — add the plugin; reference its `DATABASE_URL` from the app.
3. **`cron`** — same repo, with:
   - Start command: a `node` one-liner that POSTs to
     `/api/internal/process-scheduled-actions` with the `x-internal-secret` header.
   - Cron schedule: `*/10 * * * *`
   - Vars: `APP_URL`, `INTERNAL_CRON_SECRET` (matching the app).

After deploy, sanity-check: `https://<domain>/api/health` should return
`{"status":"ok","database":"ok"}`.

Twilio: point the WhatsApp sandbox/number "when a message comes in" webhook to
`https://<domain>/api/twilio/inbound` (POST), and the status callback to
`/api/twilio/status`.

---

## 14. Git workflow

- `main` is what Railway deploys.
- Each change goes on a feature branch → push → open a PR → review → merge.
- Merging to `main` triggers an auto-redeploy.

---

## 15. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Page shows "Application error" right after changing env vars | The service was restarting mid-request. Wait for the deploy to finish and refresh. |
| `/api/health` says `database: unavailable` | `DATABASE_URL` wrong, or migrations didn't run (check the pre-deploy command + deploy logs for `Applying migration`). |
| Bot receives messages but never replies | Check Twilio webhook URL; check app logs for `Invalid Twilio signature` (set `TWILIO_WEBHOOK_BASE_URL`); confirm `TWILIO_AUTH_TOKEN`. |
| Bot replies but keeps asking the same question / no smart answers | `OPENAI_API_KEY` missing or out of credit — it falls back to template questions. |
| Booking says "outside calling hours / in the past / busy" | Working as intended — pick a future weekday time between 9am and 6pm UK. |
| Cron returns `401` | `INTERNAL_CRON_SECRET` on the cron service doesn't match the app's. Copy the app's exact value. |
| Cron returns `200` but nothing sends | Normal when there are no due actions (`processed: 0`). |

To watch logs: Railway → the service → Deployments → **View Logs**.

---

## 16. Before going live (checklist)

- [ ] Raf approves the safeguarding / vulnerability wording.
- [ ] Approved FAQ wording confirmed by Raf.
- [ ] Move from the Twilio sandbox to a production WhatsApp number.
- [ ] Rotate any secrets that were shared during setup (session secret, cron
      secret, Google client secret + refresh token).
- [ ] Set a strong dashboard password (replace the test one).
- [ ] Remove temporary debug logging from the cron endpoint.
- [ ] Confirm follow-up delay timings with Raf.
- [ ] Run the full conversation + end-to-end test pass.

---

## 17. Build status (phases)

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: setup, DB, auth, dashboard, API skeleton | ✅ |
| 2 | WhatsApp: Twilio webhook, signature, dedup, send | ✅ |
| 3 | Conversation engine: OpenAI structured output, extraction, validation | ✅ |
| 4 | Calendar: free/busy, slots, booking, reschedule | ✅ |
| 5 | Follow-ups: cron + scheduled-action processing | ✅ |
| 6 | Safety: opt-out, guardrails, vulnerability (wording pending Raf) | ✅ (code) |

Deployed and live on Railway. Remaining work is content sign-off and the
go-live checklist above.

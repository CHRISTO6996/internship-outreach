# Internship Outreach

A local, full-stack internship email automation system. Add companies, discover publicly listed HR/recruitment addresses, verify them, generate personalised internship requests, send them one at a time from your own Gmail account, and track replies and follow-ups.

By default everything runs on your machine. Company data lives in SQLite, API keys live in a backend `.env`, and no external service is called unless you configure it. The same codebase can also be deployed publicly as a Vercel frontend plus a Railway-hosted backend, with HTTP Basic Auth protecting the sending account.

> **Honest defaults:** a fresh install has **zero integrations configured**. The dashboard, discovery, sending and Sheets pages will say so and disable the affected action instead of inventing data. You supply the website (or a search API key) until web search is configured, and emails stay `Unverified` until a verification API is configured.

---

## What it does

| Stage | Behaviour |
| --- | --- |
| Add companies | Single form, multi-line paste, Excel/CSV upload, or public Google Sheets import. Duplicates are rejected. |
| Find a website | Uses SerpAPI or Google Programmable Search when configured. Without a search API, supply the website/domain and the app verifies the domain identity. |
| Discover emails | Crawls the company site (robots.txt aware) starting from Contact/About/Careers/Recruitment/Internship pages, extracts and de-obfuscates addresses, and stores the source URL for each one. |
| Verify | DNS MX pre-screen first, then ZeroBounce, then Hunter (if configured), otherwise the address stays `Unverified`. Addresses with no MX are marked `Invalid`. |
| Pick a primary email | Only role mailboxes (`hr`, `recruitment`, `careers`, `internship`, `general`) are promoted. No readable mailbox → `Email Not Found`. |
| Generate email | Renders your template with your profile details for that specific company. |
| Send | Gmail API, one message per company, PDF resume attached where present. No CC/BCC bulk sends. Duplicate sends are prevented. Message IDs and timestamps are stored. |
| Track | Automatic tracker columns plus CSV/Excel export and an optional Google Sheets mirror. |
| Replies | Polls your Gmail inbox, matches replies to the original send (thread → sender → normalised subject), classifies them, and surfaces interviews and positive responses. |
| Follow-ups | Optional, configurable delay, one reminder per company by default, never after a reply. |

---

## Pages

1. **Dashboard** – live totals, pipeline, readiness checks, recent companies and activity.
2. **Add Companies** – four input methods, immediate discovery optional.
3. **Email Finder** – background discovery queue with live progress, pause/resume/stop and logs.
4. **Company Database** – the live tracker with filters and export.
5. **Email Outreach** – ready companies, previews, first-batch approval, send queue controls.
6. **Sent Emails** – every send with Gmail message ID, errors, retry and cancel.
7. **Inbox & Replies** – stored replies, classification and manual overrides.
8. **Follow-up Tracker** – scheduled, queued, sent, skipped and failed reminders.
9. **Spreadsheet** – the exact 12-column tracker, CSV/Excel export, Google Sheets mirror.
10. **Activity Log** – append-only audit trail with level and text filters.
11. **Integrations** – real configuration tests and setup guides for every service.
12. **Settings** – profile, resume, template, sending limits, follow-up rules, discovery tuning.

---

## Requirements

- **Node.js 22+** (developed and tested on Node 26)
- Windows, macOS or Linux
- A Google account if you want Gmail sending, reply tracking or Sheets
- Optional paid keys for search, email discovery and verification

No build tools, Python, Docker or external database are required. The database uses Node's built-in `node:sqlite`.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your local configuration
copy .env.example .env        # Windows
# cp .env.example .env        # macOS / Linux

# 3. Generate the token encryption key and paste it into .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Run the app
npm run dev
```

Open **http://localhost:5173**.

> **Windows PowerShell:** if `npm` is blocked by the execution policy, use `npm.cmd install`, `npm.cmd run dev`, and so on. Alternatively run the commands from Command Prompt.

`npm run dev` starts the API on `http://127.0.0.1:4000` and Vite with a proxy on port 5173. The dev API watches only `server/` and `.env`, so editing frontend files does not restart the backend.

### Production-style run

```bash
npm run build     # outputs dist/
npm start         # Express serves the API and the built SPA on http://127.0.0.1:4000
```

### Public deployment (Vercel UI + Railway API)

The public app uses two services from the same GitHub repository:

| Layer | Platform | Source | Purpose |
| --- | --- | --- | --- |
| UI | Vercel | repository root, `npm run build`, output `dist/` | Static React build |
| API | Railway | `Dockerfile` | Express + SQLite backend |

`vercel.json` proxies every `/api/*` request from the Vercel domain to the Railway backend, so the browser only talks to one origin.

1. **Railway backend**
   - Deploy `CHRISTO6996/internship-outreach` as a Dockerfile service.
   - Mount a persistent volume at `/data`.
   - Set the environment variables below. Never put secrets in the repository.

   ```env
   NODE_ENV=production
   HOST=[::]
   PORT=4000
   DATA_DIR=/data
   APP_BASE_URL=https://internship-outreach-production.up.railway.app
   CLIENT_BASE_URL=https://<your-vercel-project>.vercel.app
   GOOGLE_REDIRECT_URI=https://internship-outreach-production.up.railway.app/api/integrations/google/callback
   AUTH_USERNAME=admin
   AUTH_PASSWORD=<strong unique password>
   TOKEN_ENCRYPTION_KEY=<base64 from: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
   ```

   Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and any search/verification keys only when you are ready to use those integrations.

2. **Vercel frontend**
   - Import `CHRISTO6996/internship-outreach`.
   - Framework preset: **Vite**.
   - Root directory: repository root.
   - Build command: `npm run build`.
   - Output directory: `dist`.
   - No frontend environment variables are required.

3. **Google OAuth**
   - Add the Railway callback URL above to the authorised redirect URIs in Google Cloud. If `GOOGLE_REDIRECT_URI` is left blank, the backend derives the same callback from `APP_BASE_URL` (or the forwarded request headers) and shows the effective value on **Integrations**.
   - Set `CLIENT_BASE_URL` on Railway to the final Vercel URL so OAuth errors redirect back to the UI.

4. **Access control check**

   ```bash
   curl https://internship-outreach-production.up.railway.app/api/health
   curl -I https://internship-outreach-production.up.railway.app/api/dashboard/stats
   curl -u admin:'<AUTH_PASSWORD>' https://internship-outreach-production.up.railway.app/api/dashboard/stats
   ```

   `GET /api/health` is the only public route. Every other API route must return `401` without Basic Auth and succeed with it. The Vercel domain will prompt for the same credentials before the UI can read data.

### Reset everything

```bash
npm run db:reset
```

Stop the API first. This deletes the local SQLite database (and its rows) plus uploaded resumes, then recreates an empty schema.

---

## Environment variables

All values are read by the backend only. Nothing secret is sent to the browser; the Integrations page only reports whether a key is present.

### Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API / production UI port |
| `HOST` | `127.0.0.1` | Bind address (localhost only by default) |
| `APP_BASE_URL` | `http://localhost:4000` | Public base URL used in production |
| `CLIENT_BASE_URL` | blank | Where OAuth callbacks send the browser. Blank = same origin when a build exists, otherwise `http://localhost:5173` |
| `DATA_DIR` | `data` | SQLite database, uploads and resume storage |
| `DATABASE_PATH` | `data/app.db` | Override the database file |
| `LOG_LEVEL` | `info` | Server log verbosity |
| `AUTH_USERNAME` | `admin` | HTTP Basic Auth username in production |
| `AUTH_PASSWORD` | blank | Required in production; blocks access to the app and API when unset |
| `ALLOW_PUBLIC_NO_AUTH` | `false` | Escape hatch for trusted private networks only; never enable on the public internet |

### Crawling

| Variable | Default | Purpose |
| --- | --- | --- |
| `CRAWL_MAX_PAGES` | `12` | Maximum pages per website |
| `CRAWL_TIMEOUT_MS` | `12000` | Per-request timeout |
| `CRAWL_DELAY_MS` | `250` | Delay between page requests |
| `CRAWL_USER_AGENT` | `InternshipOutreachBot/0.1 …` | Identifies the crawler; it respects robots.txt |

### Discovery and verification (optional)

| Variable | Service | Effect when missing |
| --- | --- | --- |
| `SEARCH_PROVIDER` | `auto` \| `serpapi` \| `google_cse` \| `none` | Company names cannot be resolved to websites |
| `SERPAPI_KEY` | SerpAPI | Same as above |
| `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | Google Programmable Search | Same as above |
| `HUNTER_API_KEY` | Hunter.io | No indexed email enrichment |
| `ZEROBOUNCE_API_KEY` | ZeroBounce | Addresses stay `Unverified` (DNS MX only) |
| `APOLLO_API_KEY` | Apollo.io | Optional enrichment unavailable |
| `SNOV_CLIENT_ID`, `SNOV_CLIENT_SECRET` | Snov.io | Optional enrichment unavailable |

### Google (Gmail + Sheets)

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Optional callback override. Blank = derived from `APP_BASE_URL` or the proxied request headers; the effective URI is shown on Integrations |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Optional existing sheet; one is created on first sync when blank |
| `TOKEN_ENCRYPTION_KEY` | 32+ random bytes (base64). Encrypts refresh tokens at rest. **Required for OAuth.** |
| `ALLOWED_SENDER_EMAILS` | Optional comma-separated allowlist of Gmail accounts permitted to connect |

### Safety

| Variable | Default | Purpose |
| --- | --- | --- |
| `ABSOLUTE_DAILY_LIMIT` | `40` | Hard server-side ceiling, regardless of Settings |
| `SEND_DRY_RUN` | `false` | When `true`, sends are simulated and nothing leaves the machine |

---

## Setting up Google OAuth (Gmail sending, replies, Sheets)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create (or select) a project.
2. **APIs & Services → Library**: enable **Gmail API** and **Google Sheets API**.
3. **APIs & Services → OAuth consent screen**:
   - Choose **External** (or Internal for Workspace).
   - Fill in the app name and support email.
   - Add scopes:
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/spreadsheets`
     - `https://www.googleapis.com/auth/userinfo.email`
   - While the app is in **Testing**, add your Gmail address under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised redirect URI (exactly):
     ```
     http://localhost:4000/api/integrations/google/callback
     ```
5. Copy the client ID and secret into `.env`:

   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:4000/api/integrations/google/callback
   TOKEN_ENCRYPTION_KEY=...   # required, see Quick start
   ```

6. Restart the API, open **Integrations → Connect Gmail**, and approve the consent screen with the account you want to send from. **Connect Gmail** stays disabled until the OAuth client and `TOKEN_ENCRYPTION_KEY` are both present in the backend environment.

The callback exchanges the code, stores an encrypted refresh token in SQLite, and redirects back to the UI. Disconnecting removes the stored account and tokens. If the OAuth client is missing, **Connect Gmail** redirects back with an explicit error message rather than pretending to connect. After connecting, use **Test Gmail connection** on the same page: it performs a real Gmail API `users.getProfile` call and reports the mailbox, message count and thread count, or the exact API error.

> Gmail sending scopes are restricted: while the OAuth app is unverified, Google limits delivery to test users. For real outreach, complete Google's verification process or use an Internal (Workspace) app.

---

## Using the app

1. **Settings → Profile**: enter your name, college, branch, phone and contact details, and upload a PDF resume. Preparing emails is blocked until the required profile fields and resume exist.
2. **Settings → Email Template**: edit the subject/body and preview it. Placeholders: `{{companyName}}`, `{{fullName}}`, `{{college}}`, `{{branch}}`, `{{phone}}`, `{{contactEmail}}`, `{{portfolioUrl}}`, `{{linkedinUrl}}`.
3. **Settings → Sending safety**: choose approval mode, daily limit, delay range, window and weekdays.
4. **Add Companies**: add one company, paste several, upload Excel/CSV, or import a public Google Sheet. Supply a website when web search is not configured.
5. **Email Finder**: run discovery and watch the live log. Companies with no role mailbox are marked **Email Not Found** and show why.
6. **Email Outreach**: review candidates, open a preview, then prepare. With approval enabled, the first-ever batch waits for **Approve**. Later batches queue automatically. Use **Start / Pause / Resume / Stop** to control the queue.
7. **Sent Emails**: confirm Gmail message IDs and timestamps; retry failures.
8. **Inbox & Replies**: press **Check for replies**. Interviews and positive responses are flagged on the dashboard.
9. **Follow-up Tracker**: enable auto follow-ups in Settings, then queue due reminders.
10. **Spreadsheet**: export CSV/XLSX at any time. Press **Create and sync sheet** to mirror the tracker into Google Sheets.

### Sending rules enforced by the backend

- One recipient per message — no CC/BCC bulk sends.
- A company is skipped when it already has an initial send, already replied, has no primary email, or has an `Invalid` address.
- Daily limit is capped by `ABSOLUTE_DAILY_LIMIT`.
- Sends only inside the configured time window and (optionally) weekdays.
- Randomised delay between messages.
- The first batch is held for approval when `requireApproval` is on.
- Failures are recorded with the provider error; nothing is silently retried.
- Stop takes effect immediately; pause finishes the current message, then waits.
- `SEND_DRY_RUN=true` simulates the queue without contacting Gmail.

---

## Tracker columns

Exactly the requested columns, used by the UI, CSV/Excel export and the Sheets mirror:

`Company Name · Website · Company Email · Email Source · Verification · Email Status · Date Sent · Gmail Message ID · Reply Status · Reply Details · Follow-up Status · Notes`

### Status meanings

- **Verification**: `Verified`, `Unverified`, `Catch-all`, `Invalid`. Invalid addresses are never sent to.
- **Email Status**: `Not Sent`, `Sent`, `Failed`.
- **Reply Status**: `Replied`, `No Reply`, or blank before any reply.
- **Reply Details**: `Positive response`, `Internship available`, `Resume requested`, `Interview invitation`, `Rejection`, `Other`.
- **Follow-up Status**: `Pending`, `Queued`, `Sent`, `Skipped`, `Failed`, or blank.
- **Company status**: `not_started`, `email_found`, `email_not_found`, `error`.

Replies are matched in this order: Gmail thread ID → sender address → normalised subject. Anything unmatched is not stored, so unrelated inbox mail never pollutes the tracker.

---

## Project layout

```
server/
  index.js              Express app, routers, SPA serving, error mapping
  config.js             Environment parsing and integration status
  db/                   schema.sql, connection, reset script
  lib/                  settings, encryption, validation, activity, errors
  routes/               companies, jobs, dashboard, settings, integrations,
                        emails, activity, export, outreach
  services/
    discovery.js        website resolution, crawler, email extraction
    verify.js           MX, ZeroBounce, Hunter, primary selection
    jobs.js             in-process discovery queue
    google.js           OAuth, encrypted tokens, Gmail send/read
    outreach.js         send queue, approval, follow-ups, reply polling
    sheets.js           Google Sheets tracker mirror
client/src/
  App.jsx               layout and routes
  pages/                12 application pages
  components/           shared UI (cards, modal, badges, charts, …)
  lib/api.js            typed fetch wrapper
data/                   SQLite database, resumes, uploads (local only)
dist/                   production build output
```

### API surface (all `/api`)

- `GET /health`
- `GET /dashboard/stats`, `GET /dashboard/readiness`
- `GET|POST /companies`, `GET|PATCH|DELETE /companies/:id`, bulk/import/discover/emails endpoints
- `GET|POST /jobs`, SSE stream, pause/resume/stop
- `GET /emails`, `GET /activity`
- `GET|PUT /settings`, `POST|GET|DELETE /settings/resume`
- `GET /integrations`, test endpoints, `GET /integrations/google/start|callback`, `POST /integrations/google/disconnect`
- `GET /export/companies?format=csv|xlsx`
- `GET /outreach/status|candidates|sends|replies|follow-ups`, `GET /outreach/preview/:companyId`
- `POST /outreach/prepare|approve|start|pause|resume|stop|sync-replies|sheets/sync`
- `POST /outreach/sends/:id/cancel|retry`, `PATCH /outreach/replies/:id`, follow-up prepare/patch

Missing integrations return `409` with `code: "integration_not_configured"` and the exact environment variables needed.

---

## Data, privacy and security

- Company data, emails, sends, replies, follow-ups and settings live in `data/app.db`.
- OAuth refresh tokens are encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY`; plaintext tokens are never written to disk.
- The server binds to `127.0.0.1` by default locally; in production it binds to `HOST` and is protected by HTTP Basic Auth unless `ALLOW_PUBLIC_NO_AUTH=true` is explicitly set on a trusted private network.
- `AUTH_PASSWORD` is required when `NODE_ENV=production`. The app refuses to start without it; `GET /api/health` remains public for uptime checks.
- API keys are only read by the backend; the UI reports presence, never values.
- CSV/Excel export includes only data already in the tracker.
- `data/` and `.env` are git-ignored.

---

## Compliance and anti-spam

Automated outreach must comply with the law and with each provider's terms. In particular:

- Use publicly listed business addresses that are intended for contact. Never guess or construct addresses.
- Respect `robots.txt` and site terms. The crawler identifies itself and paces requests; it does not bypass blocks, logins or CAPTCHAs.
- Gmail's Terms prohibit spam and bulk unsolicited mail. Keep volumes low, personalise messages, honour rejections immediately, and never re-contact someone who asked you not to.
- Include accurate identity and contact details. Do not misrepresent your affiliation, college or experience.
- If you collect data in the EU/UK, GDPR/PECR rules may apply; in India, IT Act and spam regulations apply. You are responsible for the lawful basis of your outreach.
- The first-batch approval, daily cap, delay, send window and duplicate prevention exist to keep sending deliberate and human-reviewed.

---

## Troubleshooting

**The dashboard says an integration is not configured.** That is correct until the listed environment variable exists in `.env` and the API is restarted. The Integrations page shows exactly which keys are missing.

**A company website returns 403 during discovery.** Many corporate sites block non-browser clients. The app surfaces the error honestly rather than spoofing a browser. Add the address manually or configure Hunter.io.

**A company gets "Email Not Found".** Addresses existed but none was an HR/recruitment/careers/general mailbox, or none passed MX. Open the company and check the discovery log; you can add a known address manually.

**`npm run dev` restarts constantly.** It watches `server/` and `.env` only. If you edited `package.json` from an older version that used `node --watch`, update the script.

**Port 4000 is already in use.** Stop the other process or set `PORT` in `.env` (also update `GOOGLE_REDIRECT_URI`).

**Gmail consent fails or the callback errors.** Verify the redirect URI matches exactly, both Gmail and Sheets APIs are enabled, your account is a test user, and `TOKEN_ENCRYPTION_KEY` is set.

**Replies are not detected.** Only messages matched to a sent email by thread, sender or subject are stored. Press **Check for replies** after connecting Gmail.

**Google Sheets sync fails.** Confirm the Sheets API is enabled and the connected account can create or edit the target spreadsheet. The internal database remains authoritative.

---

## Current limitations

- No search provider, discovery enrichment or paid verification is bundled. Without keys the app relies on websites you supply and DNS MX checks.
- Gmail sending, reply polling and Sheets sync cannot be exercised until you create the OAuth client and connect an account.
- The crawler is intentionally polite and does not defeat bot protection.
- The discovery and send queues are in-process; they pause when the server stops.
- Reply classification is keyword-based and can be overridden manually.

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + Vite dev server together |
| `npm run dev:api` | API only (watches `server/` and `.env`) |
| `npm run dev:web` | Vite only |
| `npm run build` | Production build into `dist/` |
| `npm start` | Serve API + built UI |
| `npm run db:reset` | Delete local database/data and recreate the schema |

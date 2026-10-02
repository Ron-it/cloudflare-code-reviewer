# Clef Email Labeler

A Worker that labels new Gmail inbox messages every 5 minutes using [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), Cloudflare's decision model on Workers AI.

Each message gets one category label and up to two flags, all nested under `Clef/` in Gmail:

| Label | Clef question | Meaning |
|---|---|---|
| `Clef/School` | `choice` | Courses, profs, TAs, assignments, grades, university admin |
| `Clef/Dev` | `choice` | GitHub, CI, deploys, dev tool and cloud notifications |
| `Clef/Security` | `choice` | Sign-in alerts, codes, password resets |
| `Clef/Money` | `choice` | Receipts, orders, shipping, bills, failed payments |
| `Clef/Events` | `choice` | Invites, RSVPs, tickets, meetups, hackathons |
| `Clef/Career` | `choice` | Recruiters, applications, interviews, offers |
| `Clef/Newsletters` | `choice` | Newsletters, digests, product updates |
| `Clef/Promotions` | `choice` | Marketing, sales, cold outreach |
| `Clef/People` | `choice` | Personal messages that fit nowhere else |
| `Clef/Needs reply` | `noul` ≥ `FLAG_FLOOR` | A real person expects a reply |
| `Clef/Time-sensitive` | `noul` ≥ `FLAG_FLOOR` | Needs action within 7 days |

Only mail received after `LABEL_AFTER` (Unix seconds, in `wrangler.json`) is labeled, so older mail is never touched. Edit `CATEGORIES` in `src/index.ts` to change the set. The category label also marks a message as done, so there is no state store.

## Setup

1. **Google OAuth client** at [console.cloud.google.com](https://console.cloud.google.com):
   - Create a project, then enable the **Gmail API**.
   - **Google Auth Platform** → Get started → Audience: **External**.
   - **Audience** → **Publish app**. In Testing mode, Google expires the refresh token after 7 days. You'll see an "unverified app" warning when signing in; click Advanced → continue.
   - **Clients** → Create client → **Desktop app** → download the JSON.
2. Deploy and sign in:
   ```bash
   npm install
   npm run deploy
   npm run auth -- ~/Downloads/client_secret_XXXX.json
   ```
   `auth` opens Google sign-in, then stores `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` as Worker secrets and in `.dev.vars`.
3. Test a run locally against your real inbox: `npm run dev`, then `curl "http://localhost:8787/__scheduled"`.

Each labeled message is logged as one JSON line (Workers Logs is enabled), and every Clef call shows up in the `default` AI Gateway's logs.

# Deploying SubStore

This guide shows how to deploy the SubStore app to **Render.com** (free tier) so
it's reachable from the internet without running anything on your local machine.

## 1. Prepare a GitHub repository

1. Create a new empty repo on GitHub (e.g. `substore`).
2. From the project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial SubStore commit"
   git branch -M main
   git remote add origin https://github.com/<your-user>/substore.git
   git push -u origin main
   ```
   The included `.gitignore` already excludes `node_modules/`, `.env`, and the
   local `store.db` files.

## 2. Create the service on Render

Option A — **Blueprint (recommended)**
1. Sign up / log in at https://render.com
2. Click **New → Blueprint**, connect your GitHub repo.
3. Render detects `render.yaml` and proposes a `substore` web service plus a
   persistent disk mounted at `/var/data`.
4. Click **Apply**. Render will run `npm install` and start the server.

Option B — **Manual**
1. **New → Web Service**, connect your repo.
2. Environment: `Node`. Build command: `npm install`. Start command:
   `node server.js`.
3. Under **Disks**, add a disk mounted at `/var/data`, size 1 GB.
4. Under **Environment**, set `DATABASE_PATH=/var/data/store.db`.

## 3. Configure environment variables

In the Render dashboard, go to your service → **Environment** and add:

| Key                   | Value                                       |
|-----------------------|---------------------------------------------|
| `TWILIO_ACCOUNT_SID`  | Your Twilio Account SID                      |
| `TWILIO_AUTH_TOKEN`   | Your Twilio Auth Token                       |
| `DATABASE_PATH`       | `/var/data/store.db`                         |
| `NODE_VERSION`        | `20`                                         |

Save — Render will redeploy automatically.

## 4. Verify it works

- Open `https://<service>.onrender.com` — the store should load.
- Open `https://<service>.onrender.com/support-request.html` — problem page.
- Sign in with the seeded admin phone `00966580549057` (OTP goes to that phone
  via Twilio).
- Admin panel at `/admin/`, support panel at `/support/`.

## 5. Promote support agents

1. Sign in as admin.
2. Go to **Admin → Users & Roles**.
3. Change a user's role to `support`. They can now sign in at `/support/login.html`.

## 6. Twilio notes

- **Trial accounts** can only send SMS to numbers verified at
  https://console.twilio.com/us1/develop/phone-numbers/manage/verified.
- Saudi Arabia (and other regions) must be enabled under
  **Messaging → Settings → Geo Permissions** — Verify API is more permissive
  than raw SMS but still respects geo rules for trial accounts.
- Upgrade Twilio to a paid plan to send to any real phone worldwide.

## 7. Free tier caveats

Render's free web service spins down after ~15 min of inactivity; the first
request after that wakes it (takes ~30 seconds). For an always-on service,
upgrade to the starter paid plan.

The persistent disk keeps `store.db` across deploys. If you ever recreate the
service without a disk, the database (and its users/orders) will reset.

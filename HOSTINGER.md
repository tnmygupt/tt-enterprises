# Host T T Enterprises on Hostinger (step-by-step)

This app is a **Next.js** website (not a plain HTML site). On Hostinger you need a plan that can run **Node.js** — usually **VPS** or **Cloud Hosting with Node.js**. Shared “PHP-only” hosting will not work.

---

## What you need

1. A **Hostinger** account
2. A plan that supports **Node.js 22+** (recommended: **VPS KVM 1** or higher)
3. Your domain (example: `ttenterprises.in`) pointed to Hostinger
4. This project folder on your computer

Demo logins after go-live are **removed**. Use your real owner account
(e.g. phone you created in Admin → Users). Create dealers from Admin → Users.

---

## Option A — Hostinger VPS (recommended)

### 1) Buy / open VPS
1. Log in to [hPanel](https://hpanel.hostinger.com)
2. Open **VPS**
3. Choose **Ubuntu 22.04** or **24.04**
4. Note your **VPS IP address**, root password, and SSH access

### 2) Connect to the server
On Windows, open **PowerShell** and run:

```bash
ssh root@YOUR_VPS_IP
```

Enter the VPS password when asked.

### 3) Install Node.js 22
Paste these commands one block at a time:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git nginx
node -v
npm -v
```

You should see Node **v22.x**.

### 4) Upload the website code

**Easiest for non-coders:** zip this project on your PC (exclude `node_modules` and `.next` if present), upload with Hostinger File Manager / SFTP to:

```text
/var/www/tt-enterprises
```

Or with Git (if you push the project to GitHub):

```bash
mkdir -p /var/www
cd /var/www
git clone YOUR_GITHUB_REPO_URL tt-enterprises
cd tt-enterprises
```

### 5) Install and build

```bash
cd /var/www/tt-enterprises
npm install
npm run build
```

### 6) Create a startup service
Create a file:

```bash
nano /etc/systemd/system/tt-enterprises.service
```

Paste:

```ini
[Unit]
Description=TT Enterprises Next.js
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tt-enterprises
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /var/www/tt-enterprises/.next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> Note: with `output: "standalone"`, also copy static files after build:

```bash
cp -r /var/www/tt-enterprises/public /var/www/tt-enterprises/.next/standalone/
cp -r /var/www/tt-enterprises/.next/static /var/www/tt-enterprises/.next/standalone/.next/
```

Then:

```bash
systemctl daemon-reload
systemctl enable tt-enterprises
systemctl start tt-enterprises
systemctl status tt-enterprises
```

### 7) Point Nginx to the app
Create site config:

```bash
nano /etc/nginx/sites-available/tt-enterprises
```

Paste (replace `YOUR_DOMAIN.com`):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN.com www.YOUR_DOMAIN.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/tt-enterprises /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 8) Connect your domain in Hostinger
1. hPanel → **Domains**
2. Point **A record** `@` to your **VPS IP**
3. Point `www` A record to the same IP
4. Wait 5–30 minutes for DNS

### 9) Free SSL (HTTPS)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d YOUR_DOMAIN.com -d www.YOUR_DOMAIN.com
```

Open: `https://YOUR_DOMAIN.com`

---

## Option B — Hostinger “Node.js” web app (if available on your plan)

Some Hostinger business/cloud plans have **Websites → Add website → Node.js**.

1. Create Node.js app
2. Set **Node version 20**
3. Upload project files (or connect Git)
4. Build command: `npm install && npm run build`
5. Start command: `npm run start`  
   (or `node .next/standalone/server.js` after copying static files as above)
6. Set port as Hostinger shows in the panel
7. Attach domain + SSL from hPanel

If the panel does not offer Node.js, use **Option A (VPS)**.

---

## After every update (new code)

On the VPS:

```bash
cd /var/www/tt-enterprises
# upload/pull new code first
npm install
npm run build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
systemctl restart tt-enterprises
```

---

## Auto reorder cron (weekly ordered POs, owner WhatsApp)

Enable **Admin → Settings → Auto reorder**, set preferred suppliers on products, and add `CRON_SECRET` to the Node env (same as `.env.example`).

Hostinger account cron (example: every Monday 06:00 server time — use IST-aware schedule if the VPS is UTC):

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://tanmayphotos.space/api/cron/reorder
```

Or with query secret (if headers are awkward in the panel):

```bash
curl -fsS "https://tanmayphotos.space/api/cron/reorder?secret=YOUR_CRON_SECRET"
```

The endpoint skips when `autoReorderEnabled` is off, groups reorder alerts by preferred supplier, and creates **ordered** POs. Suggested qty uses sales velocity × (lead + safety days), plus open estimates, minus remaining qty on open POs. The mill is **not** WhatsApped — only `super_admin` owners get WhatsApp (and web push when VAPID is on). Staff can still message a mill from Purchases → Confirm.

## WhatsApp digest cron (overdue / credit / schemes / stale estimates / daily owner summary)

Same `CRON_SECRET`. Overdue / credit / scheme / stale-estimate dealer reminders skip if already sent within 6 days (safe to hit daily). The **super-admin daily summary** sends once per calendar day and includes top reorder SKUs, slow/dead stock, and stale estimates (stock still reserved — never auto-cancelled). Master switch: **Admin → WhatsApp desk** (or Settings). Run this every morning so the owner summary is actually daily.

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://tanmayphotos.space/api/cron/whatsapp-digest
```

Or:

```bash
curl -fsS "https://tanmayphotos.space/api/cron/whatsapp-digest?secret=YOUR_CRON_SECRET"
```

Example: reorder Monday 06:00 IST (`30 0 * * 1` if cron is UTC), digest daily 06:15 IST (`45 0 * * *` if UTC). The deploy zip also drops `config/ops.cfg` so cron works even when `CRON_SECRET` is not in hPanel.

---

## Required: hPanel environment (login fails without these)

The deploy zip **never uploads** `.env.production` or `.env.local`. Secrets must live in **hPanel**, not in the zip.

**Where:** hPanel → Websites → this site → **Deployments → Settings & Redeploy → Environment**  
(or the Node.js app **Environment variables** panel). Save, then **redeploy / restart**.

Login checks session signing **before** the password. If signing cannot run, the API returns *Server auth is misconfigured. Contact admin.* — it will not tell you whether the password was right.

| Variable | Required | Notes |
| --- | --- | --- |
| `MYSQL_HOST` | **Yes** | `localhost` on Hostinger Node. Use `srv1949.hstgr.io` from a laptop. |
| `MYSQL_PORT` | **Yes** | `3306` |
| `MYSQL_USER` | **Yes** | Prefixed DB user, e.g. `u415877111_tterp` |
| `MYSQL_PASSWORD` | **Yes** | Database password. Never put in the deploy zip. |
| `MYSQL_DATABASE` | **Yes** | e.g. `u415877111_tterp` |
| `NEXT_PUBLIC_CLOUD_DB` | **Yes** | Set `1` so the browser knows shared books are on. |
| `SESSION_SECRET` | **Yes** | Long random string. **Must differ** from `NEXT_PUBLIC_DB_API_KEY`. Signs the httpOnly login cookie. |
| `NEXT_PUBLIC_DB_API_KEY` | **Yes** | Browser key for `/api/db`. |
| `DB_API_KEY` | **Yes** | Must be **identical** to `NEXT_PUBLIC_DB_API_KEY`. |
| `CRON_SECRET` | If using auto-reorder / WhatsApp digest | Same as `.env.example`. |
| `UPLOAD_KEY` | Production uploads | Clients send `x-upload-key`. |
| `TALLY_WA_INSTANCE_KEY` | Silent WhatsApp | Instance key from [TallyWebSolutions](https://app.tallywebsolutions.in/). Server-only. |
| `TALLY_WA_ACCESS_TOKEN` | If the panel shows a second secret | Same panel. Leave unset if you only have an instance key. |
| `TALLY_WA_BASE_URL` | Optional | Default `https://app.tallywebsolutions.in`. |

Do **not** set `SESSION_SECRET` or `TT_APP_DB_GATE` to the same value as the public DB key. Copying `.env.local` onto the server is not enough if you deploy from a zip — hPanel must have the list above.

---

## Important notes for this project

1. **Shared data is Hostinger MySQL** (see env table above). Browser localStorage is a cache, not the live books. New uploads go to Hostinger disk (`/api/media`).

2. **Change admin password** after go-live (Admin → Users).

---

## Quick checklist

- [ ] Hostinger VPS/Node plan ready
- [ ] Node 22 installed
- [ ] `npm install` + `npm run build` succeeded
- [ ] App service running on port 3000
- [ ] Nginx proxy + domain A record
- [ ] SSL certificate active
- [ ] Login works on phone and computer
- [ ] Admin can add products with **size** variations

---

## Need help?

If something fails, copy these outputs and send them:

```bash
node -v
systemctl status tt-enterprises --no-pager
journalctl -u tt-enterprises -n 50 --no-pager
nginx -t
```

Then we can fix the exact error.

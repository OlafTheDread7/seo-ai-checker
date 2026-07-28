# Deploying the Search Visibility Checker as a public tool

This turns the internal SearchLens tool into a public, lead-generating web tool at
**tools.rvadigitalworks.com**, linked from your main site's `/tools` page.

The app is a Node/Express server that crawls pages, so it needs a real always-on host.
**Railway** is the recommended fit (persistent Node process, supports the streaming
site-scan; Vercel's serverless functions time out on longer crawls).

---

## What "public mode" changes

The same codebase runs two ways, controlled by the `PUBLIC_MODE` environment variable:

| | Internal (your laptop) | Public (Railway) |
|---|---|---|
| `PUBLIC_MODE` | unset / `false` | `true` |
| Single-page scan | free, full report shown | free, **score shown, full report behind email** |
| Whole-site scan | open | **requires email first** |
| Rate limiting | off | on (10 single / 4 site scans per IP per hour) |
| Hire-us CTA | off | on |
| Captured emails | — | forwarded to your inbox via Web3Forms |

So keep running it locally with `PUBLIC_MODE` unset for your own full-power audits.

---

## Environment variables (set these on Railway)

| Variable | Value | Purpose |
|---|---|---|
| `PUBLIC_MODE` | `true` | Turns on gating, rate limiting, and the CTA |
| `WEB3FORMS_KEY` | your Web3Forms access key | Where captured lead emails are sent. Get a free key at web3forms.com tied to jake@rvadigitalworks.com |
| `PORT` | *(leave unset)* | Railway sets this automatically |

---

## Step-by-step deploy (Railway)

1. **Push your latest code** to the `seo-ai-checker` GitHub repo (see the git
   commands your assistant provides).
2. Go to **railway.app** → sign in with GitHub → **New Project** → **Deploy from
   GitHub repo** → pick `seo-ai-checker`.
3. Railway auto-detects Node and runs `npm install` then `npm start`. Confirm
   `package.json` has a `start` script of `node server.js` (it does).
4. Open the new service → **Variables** → add `PUBLIC_MODE=true` and
   `WEB3FORMS_KEY=<your key>`. Redeploy if it doesn't automatically.
5. Under **Settings → Networking**, click **Generate Domain** to get a temporary
   `*.up.railway.app` URL. Open it and confirm the tool loads and a scan works.

## Point tools.rvadigitalworks.com at it

1. In Railway → service → **Settings → Networking → Custom Domain**, enter
   `tools.rvadigitalworks.com`. Railway shows a CNAME target.
2. In **GoDaddy** → your `rvadigitalworks.com` DNS, add a **CNAME** record:
   - **Name:** `tools`
   - **Value:** the target Railway gave you (e.g. `xxxx.up.railway.app`)
   - **TTL:** default
3. Wait for it to verify (usually minutes, up to an hour). Railway issues the SSL
   certificate automatically.
4. Visit **https://tools.rvadigitalworks.com** — you're live.

The `/tools` page on your main site already links here, and "Free Checker" is in
your site nav.

---

## Cost & safety notes

- Railway has a small monthly free/hobby allowance; a low-traffic tool typically
  runs a few dollars a month. Watch usage the first month.
- Rate limiting (built in) caps abuse per IP. If you ever get hammered, lower the
  limits in `server.js` (`scanLimiter` / `heavyLimiter`).
- The tool only reads publicly available HTML — it stores nothing about scanned
  sites. The only data captured is the lead email, and only when someone submits it.

---

## Test checklist after going live

- [ ] Single-page scan on a test URL returns a score + category bars, with the
      issue list hidden behind the email gate.
- [ ] Submitting an email reveals the full report and enables the PDF download —
      and the lead lands in your inbox.
- [ ] The whole-site toggle prompts for an email *before* scanning.
- [ ] The branded PDF downloads and looks right.
- [ ] The "Get a free quote" CTA links to rvadigitalworks.com/#contact.

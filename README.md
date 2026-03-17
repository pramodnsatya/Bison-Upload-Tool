# EmailBison Campaign Deployer

A web tool for deploying cold email campaigns in EmailBison — CSV upload, lead segmentation, campaign creation, sender assignment, all in one flow.

---

## Option A — Run locally

**Requirements:** Node.js v18+

```bash
chmod +x start.sh
./start.sh
```

Open **http://localhost:3000**

---

## Option B — Deploy to Railway (hosted, always-on)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "init"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/emailbison-deployer.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to **railway.app** → New Project → Deploy from GitHub repo
2. Select your repo
3. Railway auto-detects `railway.toml` and runs the build + start commands
4. Once deployed, Railway gives you a public URL like `https://emailbison-deployer.up.railway.app`

### Step 3 — Set environment variable (optional)
If your EmailBison URL ever changes, set it in Railway:
- Variable name: `EMAILBISON_URL`
- Value: `https://send.founderled.io`

That's it. No other config needed — all API keys are already in the server code.

---

## How the tool works

| Step | What happens |
|------|-------------|
| 1 | Select client from dropdown → connects to their EmailBison account |
| 2 | Upload CSV → column mapping dialog auto-detects your headers |
| 3 | Review lead breakdown (Google / Outlook / Mimecast / SEG) → choose 1–3 campaigns |
| 4 | Create campaigns in EmailBison |
| 5 | Upload leads (batched, counts verified in-app) |
| 6 | Paste email copy (3-step format) → applies to all campaigns |
| 7 | Review auto-recommended senders → confirm and assign |
| 8 | Done — pre-launch checklist shown |

---

## MX Record categorization

| MX hostname contains | Category |
|---------------------|----------|
| google / aspmx / gmail | Google |
| outlook / microsoft / office365 / hotmail | Outlook |
| mimecast | Mimecast (→ SEG campaign) |
| anything else | SEG |

---

## Sender limits
- Google senders: 15 emails/day max
- Outlook senders: 5 emails/day max
- SEG campaign uses Google senders

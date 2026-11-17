# Local job discoverer for HireMe

Checkpointed ATS watchlist + optional JobSpy boards, speaking FreeHire’s search API.

## Architecture

1. **Watchlist** (`companies.yml`) — companies to scrape (Settings UI or API)  
2. **Scrape run** — one company at a time, progress saved to `state/scrape_checkpoint.json`  
3. **Inventory** — `state/inventory/{id}.json` per company (survives crashes)  
4. **Search** — filters inventory (fast); optional JobSpy fill  
5. **Resume** — failed/paused runs continue from the next pending company  

## Setup (local only)

```bash
cd jobspy-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp companies.example.yml companies.yml
python main.py
```

Open `http://127.0.0.1:8787` for a HireMe-styled status page with a live progress bar.

```bash
HIREME_FREEHIRE_URL=http://127.0.0.1:8787
```

Settings → Job search → FreeHire → **Company watchlist**. Test connection hits `/health`.

## Cloud bridge (Vercel ↔ Mac)

Vercel cannot reach `localhost`. Bridge the sidecar with Cloudflare:

### Persistent (recommended): named tunnel

Needs a Cloudflare account and a domain on Cloudflare. The public hostname **does not change** when you restart.

```bash
brew install cloudflared
export BRIDGE_HOSTNAME=jobspy.yourdomain.com
./bridge.sh setup          # once: login, create tunnel, DNS route
export JOBSPY_BRIDGE_TOKEN=$(openssl rand -hex 24)   # or let bridge.sh generate one
./bridge.sh                # daily: sidecar + cloudflared
```

Set once on Vercel → Project → Settings → Environment Variables (Production):

| Variable | Value |
|----------|--------|
| `HIREME_FREEHIRE_URL` | `https://jobspy.yourdomain.com` |
| `HIREME_DISCOVERER` | `on` |
| `HIREME_DISCOVERER_TOKEN` | same as `JOBSPY_BRIDGE_TOKEN` |

Redeploy HireMe. Keep `./bridge.sh` running while you use Find jobs / the watchlist from the cloud app. Mac must be awake.

### Ephemeral: quick tunnel

`./bridge-quick.sh` prints a new `*.trycloudflare.com` URL every run. Fine for a trial; update `HIREME_FREEHIRE_URL` (or let the script patch Vercel when `VERCEL_TOKEN` is set) after each restart. Prefer the named tunnel for daily use.

### Security

When `JOBSPY_BRIDGE_TOKEN` is set, API routes require header `X-HireMe-Discoverer-Token` (HireMe sends `HIREME_DISCOVERER_TOKEN`). `/` and `/health` stay open for liveness.

## API

| Endpoint | Role |
|----------|------|
| `GET /health` | Liveness + `discoverer: true` |
| `GET /api/v1/companies` | List watchlist |
| `POST /api/v1/companies` | Add `{ name, ats?, slug?, url? }` |
| `DELETE /api/v1/companies/{id}` | Remove |
| `GET /api/v1/scrape/status` | Progress `%`, current company, resume flag |
| `POST /api/v1/scrape/start` | `{ resume?, force_new? }` |
| `POST /api/v1/scrape/pause` | Cooperative pause |
| `GET /api/v1/agent/jobs/search` | FreeHire-compatible search |

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `JOBSPY_ENABLE_ATS` | `1` | Watchlist scrapes |
| `JOBSPY_ENABLE_BOARDS` | `1` | JobSpy boards |
| `JOBSPY_AUTO_SCRAPE_ON_EMPTY` | `1` | Start scrape when inventory empty |
| `JOBSPY_ATS_MAX_PER_COMPANY` | `40` | Cap per board |
| `JOBSPY_STATE_DIR` | `./state` | Checkpoint + inventory |
| `JOBSPY_BRIDGE` | off | Bind for tunnel use; implied when token set |
| `JOBSPY_BRIDGE_TOKEN` | unset | Require token on API (cloud bridge) |
| `JOBSPY_HOST` | `127.0.0.1` (or `0.0.0.0` when bridging) | Listen address |

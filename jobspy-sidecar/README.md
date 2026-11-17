# Local job discoverer for HireMe

Checkpointed ATS watchlist + optional JobSpy boards, speaking FreeHire’s search API.

## Architecture

1. **Watchlist** (`companies.yml`) — companies to scrape (Settings UI or API)  
2. **Scrape run** — one company at a time, progress saved to `state/scrape_checkpoint.json`  
3. **Inventory** — `state/inventory/{id}.json` per company (survives crashes)  
4. **Search** — filters inventory (fast); optional JobSpy fill  
5. **Resume** — failed/paused runs continue from the next pending company  

## Setup

```bash
cd jobspy-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp companies.example.yml companies.yml
python main.py
```

Open `http://127.0.0.1:8787` for a HireMe-styled status page with a live progress bar.

## HireMe

```bash
HIREME_FREEHIRE_URL=http://127.0.0.1:8787
```

Settings → Job search → FreeHire → **Company watchlist** (add/remove, Refresh / Resume / Pause).  
Test connection hits `/health` (instant). Agent → **Run all now** searches the inventory.

## API

| Endpoint | Role |
|----------|------|
| `GET /health` | Liveness + scrape summary |
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

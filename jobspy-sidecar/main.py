"""
Local FreeHire-compatible job discoverer for HireMe.

Architecture:
  - Watchlist (companies.yml) managed via API / Settings UI
  - Checkpointed ATS scrape → durable inventory on disk (resume-safe)
  - Search filters inventory (fast); optional JobSpy boards as fill
  - Progress API for UI progress bars

HireMe: HIREME_FREEHIRE_URL=http://127.0.0.1:8787 → FreeHire → Run all now
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

import scrape as scrape_runner
import store


def _env_on(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() not in {"0", "false", "off", "no"}


BRIDGE_TOKEN = os.environ.get("JOBSPY_BRIDGE_TOKEN", "").strip()
BRIDGE = _env_on("JOBSPY_BRIDGE", "0") if "JOBSPY_BRIDGE" in os.environ else bool(BRIDGE_TOKEN)
HOST = os.environ.get("JOBSPY_HOST") or ("0.0.0.0" if BRIDGE else "127.0.0.1")
PORT = int(os.environ.get("JOBSPY_PORT", "8787"))
CACHE_TTL_SEC = int(os.environ.get("JOBSPY_CACHE_TTL_SEC", "900"))
RESULTS_PER_SITE = int(os.environ.get("JOBSPY_RESULTS_PER_SITE", "20"))
ENABLE_JOBSPY = _env_on("JOBSPY_ENABLE_BOARDS")
ENABLE_ATS = _env_on("JOBSPY_ENABLE_ATS")
AUTO_SCRAPE_ON_EMPTY = _env_on("JOBSPY_AUTO_SCRAPE_ON_EMPTY")

SITES = [
    part.strip()
    for part in os.environ.get(
        "JOBSPY_SITES",
        "indeed,linkedin,zip_recruiter,glassdoor",
    ).split(",")
    if part.strip()
]

COUNTRY_INDEED: dict[str, str] = {
    "ar": "Argentina",
    "au": "Australia",
    "at": "Austria",
    "be": "Belgium",
    "br": "Brazil",
    "ca": "Canada",
    "ch": "Switzerland",
    "de": "Germany",
    "dk": "Denmark",
    "es": "Spain",
    "fi": "Finland",
    "fr": "France",
    "gb": "UK",
    "uk": "UK",
    "ie": "Ireland",
    "in": "India",
    "it": "Italy",
    "jp": "Japan",
    "mx": "Mexico",
    "nl": "Netherlands",
    "nz": "New Zealand",
    "pl": "Poland",
    "pt": "Portugal",
    "se": "Sweden",
    "sg": "Singapore",
    "us": "USA",
}

PERIOD_MAP = {
    "yearly": "year",
    "annual": "year",
    "year": "year",
    "monthly": "month",
    "month": "month",
    "weekly": "week",
    "week": "week",
    "daily": "day",
    "day": "day",
    "hourly": "hour",
    "hour": "hour",
}

_cache_lock = threading.Lock()
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

app = FastAPI(title="HireMe local job discoverer", version="2.0.0")
store.ensure_dirs()


class BridgeAuthMiddleware(BaseHTTPMiddleware):
    """When JOBSPY_BRIDGE_TOKEN is set, API routes require that token (cloud bridge)."""

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        if not BRIDGE_TOKEN:
            return await call_next(request)
        path = request.url.path
        if request.method == "GET" and path in {"/", "/health"}:
            return await call_next(request)
        header = (request.headers.get("x-hireme-discoverer-token") or "").strip()
        auth = (request.headers.get("authorization") or "").strip()
        bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if header != BRIDGE_TOKEN and bearer != BRIDGE_TOKEN:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


app.add_middleware(BridgeAuthMiddleware)


class Health(BaseModel):
    ok: bool = True
    discoverer: bool = True
    bridge: bool = False
    sites: list[str] = Field(default_factory=list)
    ats_enabled: bool = True
    boards_enabled: bool = True
    companies: int = 0
    inventory_jobs: int = 0
    scrape: dict[str, Any] = Field(default_factory=dict)


class CompanyIn(BaseModel):
    name: str = ""
    ats: str = ""
    slug: str = ""
    url: str = ""


class ScrapeIn(BaseModel):
    resume: bool = False
    force_new: bool = False


def _split_query(q: str) -> tuple[str, str]:
    text = (q or "").strip()
    if not text:
        return "", ""
    match = re.search(r"\s+in\s+(.+)$", text, flags=re.IGNORECASE)
    if not match:
        return text, ""
    location = match.group(1).strip()
    if not location or len(location) > 80:
        return text, ""
    keywords = text[: match.start()].strip()
    return keywords or text, location


def _country_indeed(countries: str | None) -> str:
    if not countries:
        return "USA"
    code = countries.split(",")[0].strip().lower()
    return COUNTRY_INDEED.get(code, "USA")


def _country_code(countries: str | None) -> str | None:
    if not countries:
        return None
    code = countries.split(",")[0].strip().upper()
    return code or None


def _tokens(text: str) -> list[str]:
    return [part.lower() for part in re.split(r"\s+", text.strip()) if len(part) > 1]


def _matches_keywords(job: dict[str, Any], keywords: str) -> bool:
    tokens = _tokens(keywords)
    if not tokens:
        return True
    hay = " ".join(
        [
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            str(job.get("location") or ""),
            str(job.get("description") or "")[:4000],
        ]
    ).lower()
    head = f"{job.get('title') or ''} {job.get('company') or ''}".lower()
    if any(token in head for token in tokens):
        return True
    return all(token in hay for token in tokens)


def _matches_location(job: dict[str, Any], location: str, country: str | None, remote_only: bool) -> bool:
    if remote_only and job.get("work_mode") == "onsite":
        return False
    place = f"{job.get('location') or ''}".lower()
    if location:
        needle = location.lower()
        if needle not in place and job.get("work_mode") != "remote":
            return False
    if country and job.get("_country"):
        if str(job["_country"]).upper() != country.upper() and job.get("work_mode") != "remote":
            return False
    return True


def _posted_within_ok(posted_at: str | None, days: int | None) -> bool:
    if not days or not posted_at:
        return True
    try:
        when = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except Exception:
        return True
    age = datetime.now(timezone.utc) - when.astimezone(timezone.utc)
    return age.total_seconds() <= days * 86400


def _dedupe(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for job in jobs:
        url = (job.get("url") or "").strip().lower()
        key = url or job.get("public_slug") or ""
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({k: v for k, v in job.items() if not str(k).startswith("_")})
    return out


def _posted_at(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            dt = value
            if getattr(dt, "tzinfo", None) is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except Exception:
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return None


def _row_to_job(row: dict[str, Any]) -> dict[str, Any]:
    description = str(row.get("description") or "").strip()[:100_000]
    url = str(row.get("job_url_direct") or row.get("job_url") or "").strip() or None
    loc = row.get("location")
    if loc is not None and not isinstance(loc, str):
        parts = [getattr(loc, name, None) for name in ("city", "state", "country")]
        loc = ", ".join(str(part) for part in parts if part) or None
    remote = row.get("is_remote")
    work_mode = "remote" if remote is True else ("onsite" if remote is False else None)
    minimum, maximum = row.get("min_amount"), row.get("max_amount")
    enrichment = None
    if minimum is not None or maximum is not None:
        enrichment = {
            "salary_min": float(minimum) if minimum is not None else None,
            "salary_max": float(maximum) if maximum is not None else None,
            "salary_currency": (str(row.get("currency") or "").strip() or None),
            "salary_period": PERIOD_MAP.get(str(row.get("interval") or "").lower()),
        }
    seed = f"{row.get('id')}|{url}|{row.get('site')}|{row.get('title')}|{row.get('company')}"
    return {
        "public_slug": hashlib.sha1(seed.encode()).hexdigest()[:20],
        "title": (str(row.get("title") or "").strip() or None),
        "company": (str(row.get("company") or "").strip() or None),
        "location": (str(loc).strip() if loc else None) or None,
        "url": url,
        "source": (str(row.get("site") or "").strip() or None),
        "work_mode": work_mode,
        "posted_at": _posted_at(row.get("date_posted")),
        "description": description or None,
        "enrichment": enrichment,
    }


def _scrape_boards(keywords: str, location: str, countries: str | None, work_mode: str | None, posted_within_days: int | None) -> tuple[list[dict[str, Any]], str | None]:
    if not ENABLE_JOBSPY:
        return [], None
    try:
        from jobspy import scrape_jobs
    except Exception as exc:  # noqa: BLE001
        return [], f"jobspy import: {exc}"
    hours_old = None if not posted_within_days else max(1, int(posted_within_days) * 24)
    kwargs: dict[str, Any] = {
        "site_name": SITES,
        "search_term": keywords or "developer",
        "location": location or None,
        "results_wanted": max(1, RESULTS_PER_SITE),
        "country_indeed": _country_indeed(countries),
        "description_format": "plain",
        "verbose": 0,
        "is_remote": True if work_mode == "remote" else None,
    }
    if hours_old is not None:
        kwargs["hours_old"] = hours_old
    try:
        df = scrape_jobs(**{k: v for k, v in kwargs.items() if v is not None})
    except Exception as exc:  # noqa: BLE001
        return [], str(exc)
    if df is None:
        return [], None
    clean = df.where(df.notna(), None)
    return [_row_to_job(dict(record)) for record in clean.to_dict(orient="records")], None


def _filter_inventory(q: str, countries: str | None, work_mode: str | None, posted_within_days: int | None) -> list[dict[str, Any]]:
    keywords, location = _split_query(q)
    country = _country_code(countries)
    remote_only = work_mode == "remote"
    out: list[dict[str, Any]] = []
    for job in scrape_runner.inventory_jobs():
        if not _matches_keywords(job, keywords):
            continue
        if not _matches_location(job, location, country, remote_only):
            continue
        if not _posted_within_ok(job.get("posted_at"), posted_within_days):
            continue
        out.append(job)
    return out


def _cache_key(q: str, countries: str | None, work_mode: str | None, posted_within_days: int | None) -> str:
    return "|".join([q.strip().lower(), (countries or "").upper(), (work_mode or ""), str(posted_within_days or "")])


def _get_cached(key: str) -> list[dict[str, Any]] | None:
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        expires_at, jobs = entry
        if time.time() > expires_at:
            del _cache[key]
            return None
        return list(jobs)


def _set_cached(key: str, jobs: list[dict[str, Any]]) -> None:
    with _cache_lock:
        _cache[key] = (time.time() + CACHE_TTL_SEC, list(jobs))


def discover(q: str, countries: str | None, work_mode: str | None, posted_within_days: int | None) -> tuple[list[dict[str, Any]], list[str]]:
    notes: list[str] = []
    inventory = scrape_runner.inventory_jobs()
    progress = scrape_runner.status()
    if ENABLE_ATS and AUTO_SCRAPE_ON_EMPTY and not inventory and progress.get("status") not in {"running"}:
        # Cold start: kick a scrape so the next search has data; return what boards give now.
        scrape_runner.start_scrape(force_new=True)
        notes.append("ATS inventory empty — scrape started in the background. Retry shortly or watch /scrape/status.")

    ats_jobs = _filter_inventory(q, countries, work_mode, posted_within_days) if ENABLE_ATS else []
    keywords, location = _split_query(q)
    board_jobs, board_error = _scrape_boards(keywords, location, countries, work_mode, posted_within_days)
    if board_error:
        notes.append(f"boards: {board_error}")
    return _dedupe([*ats_jobs, *board_jobs]), notes


# ── Pages & health ───────────────────────────────────────────────────────────

def _page_html() -> str:
    progress = scrape_runner.status()
    companies = store.list_companies()
    inv = len(scrape_runner.inventory_jobs())
    percent = progress.get("percent") or 0
    status = progress.get("status") or "idle"
    message = progress.get("message") or ""
    current = progress.get("current") or "—"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HireMe · Local discoverer</title>
  <style>
    :root {{
      color-scheme: light dark;
      --paper: light-dark(#eeebe4, #1a1917);
      --surface: light-dark(#f4f2ed, #22201d);
      --card: light-dark(#fbfaf7, #2a2825);
      --ink: light-dark(#1d1c1a, #f0ede7);
      --muted: light-dark(#69655d, #aaa59c);
      --line: light-dark(rgb(29 28 26 / 0.1), rgb(240 237 231 / 0.1));
      --primary: light-dark(#222222, #ebe7df);
      --on-primary: light-dark(#fbfaf7, #1d1c1a);
      --success: light-dark(#2f6b4a, #4ade80);
      --error: light-dark(#9a3a2c, #f87171);
      --track: light-dark(rgb(29 28 26 / 0.08), rgb(240 237 231 / 0.1));
      --radius: 12px;
      --font: "Geist", "IBM Plex Sans", system-ui, sans-serif;
      --serif: "Newsreader", "EB Garamond", Georgia, serif;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; background: var(--paper); color: var(--ink);
      font: 15px/1.5 var(--font);
    }}
    main {{
      max-width: 40rem; margin: 2.5rem auto; padding: 1.75rem 1.75rem 2rem;
      background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 12px 40px light-dark(rgb(40 35 25 / 0.1), rgb(0 0 0 / 0.45));
    }}
    .brand {{ font: 600 13px/1.3 var(--font); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }}
    h1 {{ font: 400 2rem/1.15 var(--serif); margin: 0.35rem 0 0.5rem; }}
    p {{ color: var(--muted); margin: 0 0 1rem; }}
    .card {{
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 1rem 1.1rem; margin: 1rem 0;
    }}
    .row {{ display: flex; justify-content: space-between; gap: 1rem; font-size: 13.5px; margin: 0.35rem 0; }}
    .row span:last-child {{ color: var(--ink); font-weight: 500; text-align: right; }}
    .bar {{
      height: 8px; border-radius: 999px; background: var(--track); overflow: hidden; margin: 0.75rem 0 0.35rem;
    }}
    .bar > i {{
      display: block; height: 100%; width: {percent}%; background: var(--primary);
      transition: width 0.4s ease;
    }}
    .actions {{ display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }}
    button, a.btn {{
      appearance: none; border: 1px solid var(--line); background: var(--card); color: var(--ink);
      border-radius: 8px; padding: 0.45rem 0.85rem; font: 600 13.5px var(--font); cursor: pointer;
      text-decoration: none;
    }}
    button.primary {{ background: var(--primary); color: var(--on-primary); border-color: transparent; }}
    button:disabled {{ opacity: 0.5; cursor: default; }}
    code {{ font-size: 12.5px; background: var(--paper); padding: 0.1rem 0.35rem; border-radius: 4px; }}
    ul {{ margin: 0.4rem 0 0; padding-left: 1.1rem; color: var(--muted); font-size: 13.5px; }}
    .ok {{ color: var(--success); }} .bad {{ color: var(--error); }}
  </style>
</head>
<body>
  <main>
    <div class="brand">HireMe</div>
    <h1>Local job discoverer</h1>
    <p>FreeHire-compatible feed for Find jobs and the Job agent. This page is status only — the Agent list updates when HireMe calls the API.</p>

    <div class="card" id="progress-card">
      <div class="row"><span>Scrape</span><span id="status">{status}</span></div>
      <div class="row"><span>Progress</span><span id="counts">{progress.get("done", 0)} / {progress.get("total", 0)} · {percent}%</span></div>
      <div class="row"><span>Current</span><span id="current">{current}</span></div>
      <div class="bar" aria-hidden="true"><i id="bar" style="width:{percent}%"></i></div>
      <p id="message" style="margin:0.35rem 0 0;font-size:13px">{message}</p>
      <div class="actions">
        <button class="primary" type="button" onclick="startScrape(false)">Refresh all</button>
        <button type="button" onclick="startScrape(true)">Resume</button>
        <button type="button" onclick="pauseScrape()">Pause</button>
        <a class="btn" href="/health">Health JSON</a>
      </div>
    </div>

    <div class="card">
      <div class="row"><span>Watchlist</span><span>{len(companies)} companies</span></div>
      <div class="row"><span>Inventory</span><span>{inv} jobs cached</span></div>
      <div class="row"><span>Boards</span><span>{"on" if ENABLE_JOBSPY else "off"} · {", ".join(SITES)}</span></div>
      <p style="margin-top:0.85rem;margin-bottom:0.35rem;font-size:13px">In HireMe set <code>HIREME_FREEHIRE_URL=http://{HOST}:{PORT}</code>, choose FreeHire, manage companies in Settings → Job search, then <strong>Run all now</strong>.</p>
      <ul>
        <li>Search API: <code>/api/v1/agent/jobs/search</code></li>
        <li>Companies: <code>/api/v1/companies</code></li>
        <li>Progress: <code>/api/v1/scrape/status</code></li>
      </ul>
    </div>
  </main>
  <script>
    async function refresh() {{
      const r = await fetch('/api/v1/scrape/status');
      const p = await r.json();
      document.getElementById('status').textContent = p.status;
      document.getElementById('counts').textContent = `${{p.done}} / ${{p.total}} · ${{p.percent}}%`;
      document.getElementById('current').textContent = p.current || '—';
      document.getElementById('message').textContent = p.message || '';
      document.getElementById('bar').style.width = (p.percent || 0) + '%';
    }}
    async function startScrape(resume) {{
      await fetch('/api/v1/scrape/start', {{
        method: 'POST',
        headers: {{ 'content-type': 'application/json' }},
        body: JSON.stringify({{ resume, force_new: !resume }})
      }});
      refresh();
    }}
    async function pauseScrape() {{
      await fetch('/api/v1/scrape/pause', {{ method: 'POST' }});
      refresh();
    }}
    setInterval(refresh, 1500);
  </script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def home() -> str:
    return _page_html()


@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(
        ok=True,
        discoverer=True,
        bridge=BRIDGE or bool(BRIDGE_TOKEN),
        sites=list(SITES),
        ats_enabled=ENABLE_ATS,
        boards_enabled=ENABLE_JOBSPY,
        companies=len(store.list_companies()),
        inventory_jobs=len(scrape_runner.inventory_jobs()),
        scrape=scrape_runner.status(),
    )


# ── Companies CRUD ───────────────────────────────────────────────────────────

@app.get("/api/v1/companies")
def companies_list() -> dict[str, Any]:
    return {"data": store.list_companies()}


@app.post("/api/v1/companies")
def companies_add(body: CompanyIn) -> JSONResponse:
    try:
        company = store.add_company(body.model_dump())
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    return JSONResponse({"data": company})


@app.delete("/api/v1/companies/{company_id}")
def companies_remove(company_id: str) -> JSONResponse:
    if not store.remove_company(company_id):
        return JSONResponse(status_code=404, content={"error": "Company not found."})
    return JSONResponse({"ok": True})


# ── Scrape progress / control ────────────────────────────────────────────────

@app.get("/api/v1/scrape/status")
def scrape_status() -> dict[str, Any]:
    return scrape_runner.status()


@app.post("/api/v1/scrape/start")
def scrape_start(body: ScrapeIn | None = None) -> dict[str, Any]:
    body = body or ScrapeIn()
    return scrape_runner.start_scrape(resume=body.resume, force_new=body.force_new)


@app.post("/api/v1/scrape/pause")
def scrape_pause() -> dict[str, Any]:
    return scrape_runner.pause_scrape()


# ── FreeHire-compatible search ───────────────────────────────────────────────

@app.get("/api/v1/agent/jobs/search")
def search(
    q: str = Query(default=""),
    description_format: str = Query(default="text"),  # noqa: ARG001
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    countries: str | None = Query(default=None),
    work_mode: str | None = Query(default=None),
    posted_within_days: int | None = Query(default=None),
) -> JSONResponse:
    key = _cache_key(q, countries, work_mode, posted_within_days)
    jobs = _get_cached(key)
    notes: list[str] = []
    if jobs is None:
        try:
            jobs, notes = discover(q, countries, work_mode, posted_within_days)
        except Exception as exc:  # noqa: BLE001
            return JSONResponse(status_code=503, content={"error": "unavailable", "detail": str(exc)})
        _set_cached(key, jobs)

    total = len(jobs)
    page = jobs[offset : offset + limit]
    meta: dict[str, Any] = {
        "total": total,
        "limit": limit,
        "offset": offset,
        "scrape": scrape_runner.status(),
    }
    if notes:
        meta["notes"] = notes
    return JSONResponse({"data": page, "meta": meta})


def main() -> None:
    import uvicorn

    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)


if __name__ == "__main__":
    main()

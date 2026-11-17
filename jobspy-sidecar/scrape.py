"""Checkpointed ATS scrape runner — resume from the last unfinished company."""

from __future__ import annotations

import html
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

from store import (
    company_key,
    empty_checkpoint,
    load_all_inventory,
    load_checkpoint,
    load_companies,
    load_inventory,
    progress_view,
    save_checkpoint,
    save_inventory,
)

ATS_MAX_PER_COMPANY = int(os.environ.get("JOBSPY_ATS_MAX_PER_COMPANY", "40"))
ENABLE_ATS = os.environ.get("JOBSPY_ENABLE_ATS", "1").strip().lower() not in {"0", "false", "off", "no"}

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")
_runner_lock = threading.Lock()
_runner_thread: threading.Thread | None = None
_stop_requested = False

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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _plain(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", str(value)))
    return _SPACE_RE.sub(" ", text).strip()


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


def _ats_to_job(job: Any, company_name: str) -> dict[str, Any]:
    data = job.model_dump() if hasattr(job, "model_dump") else dict(job)
    ats = str(data.get("ats_type") or "ats")
    if hasattr(data.get("ats_type"), "value"):
        ats = str(data["ats_type"].value)
    description = _plain(data.get("description"))[:100_000]
    url = str(data.get("apply_url") or data.get("url") or "").strip() or None
    company = company_name or str(data.get("company") or "").strip() or None
    remote = data.get("is_remote")
    work_mode = "remote" if remote is True else ("onsite" if remote is False else None)
    period = data.get("salary_period")
    period_key = str(period).lower() if period else ""
    enrichment = None
    if data.get("salary_min") is not None or data.get("salary_max") is not None:
        enrichment = {
            "salary_min": data.get("salary_min"),
            "salary_max": data.get("salary_max"),
            "salary_currency": data.get("salary_currency"),
            "salary_period": PERIOD_MAP.get(period_key, period_key or None),
        }
    seed = str(data.get("global_id") or data.get("ats_id") or url or "")
    public_slug = __import__("hashlib").sha1(f"{seed}|{ats}".encode()).hexdigest()[:20]
    return {
        "public_slug": public_slug,
        "title": (str(data.get("title") or "").strip() or None),
        "company": company,
        "location": (str(data.get("location") or "").strip() or None),
        "url": url,
        "source": ats,
        "work_mode": work_mode,
        "posted_at": _posted_at(data.get("posted_at")),
        "description": description or None,
        "enrichment": enrichment,
        "_country": data.get("country_iso"),
    }


def fetch_company(entry: dict[str, str]) -> list[dict[str, Any]]:
    from ats_scrapers import get_scraper_for_url
    from ats_scrapers.scrapers import get_scraper

    scraper = None
    if entry.get("url"):
        scraper = get_scraper_for_url(entry["url"])
    elif entry.get("ats") and entry.get("slug"):
        scraper = get_scraper(entry["ats"], entry["slug"])
    if scraper is None:
        return []
    raw = scraper.fetch()
    name = entry.get("name") or entry.get("slug") or ""
    jobs = [_ats_to_job(item, name) for item in raw]
    if ATS_MAX_PER_COMPANY > 0:
        jobs = jobs[:ATS_MAX_PER_COMPANY]
    return jobs


def _align_checkpoint(force_new: bool) -> dict[str, Any]:
    companies = load_companies()
    if force_new:
        cp = empty_checkpoint(companies)
        cp["status"] = "running"
        cp["started_at"] = _now()
        cp["message"] = "Starting fresh scrape…"
        save_checkpoint(cp)
        return cp

    cp = load_checkpoint()
    by_id = {c["id"]: c for c in cp.get("companies") or []}
    rebuilt = []
    for entry in companies:
        cid = company_key(entry)
        prev = by_id.get(cid)
        if prev and prev.get("status") in {"done", "failed"} and not force_new:
            rebuilt.append(prev)
        else:
            rebuilt.append(
                {
                    "id": cid,
                    "name": entry.get("name") or entry.get("slug") or "company",
                    "status": "pending",
                    "jobs": 0,
                    "error": None,
                    "finished_at": None,
                }
            )
    cp["companies"] = rebuilt
    cp["total"] = len(rebuilt)
    cp["done"] = sum(1 for c in rebuilt if c.get("status") == "done")
    cp["failed"] = sum(1 for c in rebuilt if c.get("status") == "failed")
    cp["cursor"] = next((i for i, c in enumerate(rebuilt) if c.get("status") == "pending"), len(rebuilt))
    cp["status"] = "running"
    cp["started_at"] = cp.get("started_at") or _now()
    cp["finished_at"] = None
    cp["message"] = "Resuming scrape…" if cp["cursor"] > 0 else "Starting scrape…"
    save_checkpoint(cp)
    return cp


def _run(force_new: bool) -> None:
    global _stop_requested, _runner_thread
    try:
        if not ENABLE_ATS:
            cp = load_checkpoint()
            cp["status"] = "done"
            cp["message"] = "ATS scraping is disabled."
            cp["finished_at"] = _now()
            save_checkpoint(cp)
            return

        # start_scrape already aligned; only re-align when called directly with force_new.
        cp = _align_checkpoint(True) if force_new else load_checkpoint()
        if cp.get("status") != "running":
            cp["status"] = "running"
            cp["message"] = cp.get("message") or "Scraping…"
            save_checkpoint(cp)
        companies = load_companies()
        by_id = {company_key(e): e for e in companies}

        for index, item in enumerate(cp["companies"]):
            if _stop_requested:
                cp["status"] = "paused"
                cp["message"] = f"Paused at {item['name']}."
                cp["current"] = item["name"]
                save_checkpoint(cp)
                return
            if item.get("status") in {"done", "failed"}:
                continue

            entry = by_id.get(item["id"])
            if not entry:
                item["status"] = "failed"
                item["error"] = "Removed from watchlist"
                item["finished_at"] = _now()
                cp["failed"] = int(cp.get("failed") or 0) + 1
                cp["cursor"] = index + 1
                save_checkpoint(cp)
                continue

            cp["current"] = entry.get("name")
            cp["cursor"] = index
            cp["message"] = f"Scraping {entry.get('name')} ({index + 1}/{cp['total']})…"
            item["status"] = "running"
            save_checkpoint(cp)

            try:
                jobs = fetch_company(entry)
                # Strip internal fields before disk.
                clean = [{k: v for k, v in job.items() if not str(k).startswith("_")} for job in jobs]
                save_inventory(item["id"], clean, {"name": entry.get("name")})
                item["status"] = "done"
                item["jobs"] = len(clean)
                item["error"] = None
                item["finished_at"] = _now()
                cp["done"] = int(cp.get("done") or 0) + 1
            except Exception as exc:  # noqa: BLE001
                item["status"] = "failed"
                item["error"] = str(exc)
                item["jobs"] = 0
                item["finished_at"] = _now()
                cp["failed"] = int(cp.get("failed") or 0) + 1
                # Keep going — failed company is checkpointed; resume skips it unless force_new.

            cp["cursor"] = index + 1
            cp["companies"][index] = item
            save_checkpoint(cp)

        cp["status"] = "done"
        cp["current"] = None
        cp["finished_at"] = _now()
        cp["message"] = f"Done · {cp.get('done', 0)} ok · {cp.get('failed', 0)} failed"
        save_checkpoint(cp)
    finally:
        _stop_requested = False
        with _runner_lock:
            _runner_thread = None


def start_scrape(*, resume: bool = False, force_new: bool = False) -> dict[str, Any]:
    """Start or resume a checkpointed scrape. Returns progress view."""
    global _runner_thread, _stop_requested
    with _runner_lock:
        if _runner_thread and _runner_thread.is_alive():
            return progress_view()
        _stop_requested = False
        # Align checkpoint on the request thread so the UI sees running/percent immediately.
        reset = force_new and not resume
        _align_checkpoint(reset)
        thread = threading.Thread(target=_run, args=(False,), daemon=True)  # already aligned; don't reset again
        _runner_thread = thread
        thread.start()
    return progress_view()


def pause_scrape() -> dict[str, Any]:
    global _stop_requested
    _stop_requested = True
    cp = load_checkpoint()
    if cp.get("status") == "running":
        cp["message"] = "Pause requested…"
        save_checkpoint(cp)
    return progress_view()


def status() -> dict[str, Any]:
    return progress_view()


def inventory_jobs() -> list[dict[str, Any]]:
    return load_all_inventory()


def company_jobs(company_id: str) -> list[dict[str, Any]]:
    return load_inventory(company_id)

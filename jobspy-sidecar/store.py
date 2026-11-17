"""Durable watchlist, per-company inventory, and scrape checkpoints."""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent
STATE_DIR = Path(__import__("os").environ.get("JOBSPY_STATE_DIR", str(ROOT / "state")))
COMPANIES_PATH = Path(__import__("os").environ.get("JOBSPY_COMPANIES_FILE", str(ROOT / "companies.yml")))
CHECKPOINT_PATH = STATE_DIR / "scrape_checkpoint.json"
INVENTORY_DIR = STATE_DIR / "inventory"

_lock = threading.RLock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    INVENTORY_DIR.mkdir(parents=True, exist_ok=True)


def company_key(entry: dict[str, str]) -> str:
    raw = entry.get("url") or f"{entry.get('ats', '')}:{entry.get('slug', '')}" or entry.get("name", "")
    digest = hashlib.sha1(raw.strip().lower().encode("utf-8")).hexdigest()[:12]
    name = "".join(ch if ch.isalnum() else "-" for ch in (entry.get("name") or "company").lower()).strip("-")[:40]
    return f"{name or 'company'}-{digest}"


def _normalize(entry: dict[str, Any]) -> dict[str, str] | None:
    if not isinstance(entry, dict):
        return None
    out = {
        "name": str(entry.get("name") or "").strip(),
        "ats": str(entry.get("ats") or "").strip().lower(),
        "slug": str(entry.get("slug") or "").strip(),
        "url": str(entry.get("url") or "").strip(),
    }
    if not (out["url"] or (out["ats"] and out["slug"])):
        return None
    if not out["name"]:
        out["name"] = out["slug"] or out["url"]
    return out


def load_companies() -> list[dict[str, str]]:
    path = COMPANIES_PATH if COMPANIES_PATH.exists() else ROOT / "companies.example.yml"
    if not path.exists():
        return []
    with _lock:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        rows = data.get("companies") if isinstance(data, dict) else data
        companies: list[dict[str, str]] = []
        for row in rows or []:
            entry = _normalize(row)
            if entry:
                companies.append(entry)
        return companies


def save_companies(companies: list[dict[str, str]]) -> None:
    ensure_dirs()
    path = COMPANIES_PATH
    payload = {"companies": companies}
    text = (
        "# HireMe local discoverer watchlist — edited by the sidecar API / Settings UI.\n"
        "# Prefer ats+slug, or a careers url.\n\n"
        + yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
    )
    with _lock:
        path.write_text(text, encoding="utf-8")


def list_companies() -> list[dict[str, Any]]:
    return [{**entry, "id": company_key(entry)} for entry in load_companies()]


def add_company(entry: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize(entry)
    if not normalized:
        raise ValueError("Provide a careers url, or ats + slug (and ideally a name).")
    companies = load_companies()
    new_id = company_key(normalized)
    for existing in companies:
        if company_key(existing) == new_id or (
            existing["name"].lower() == normalized["name"].lower()
            and (existing.get("slug") == normalized.get("slug") or existing.get("url") == normalized.get("url"))
        ):
            raise ValueError(f"“{normalized['name']}” is already on the watchlist.")
    companies.append(normalized)
    save_companies(companies)
    return {**normalized, "id": new_id}


def remove_company(company_id: str) -> bool:
    companies = load_companies()
    kept = [entry for entry in companies if company_key(entry) != company_id]
    if len(kept) == len(companies):
        return False
    save_companies(kept)
    inv = INVENTORY_DIR / f"{company_id}.json"
    if inv.exists():
        inv.unlink()
    return True


def inventory_path(company_id: str) -> Path:
    return INVENTORY_DIR / f"{company_id}.json"


def save_inventory(company_id: str, jobs: list[dict[str, Any]], meta: dict[str, Any] | None = None) -> None:
    ensure_dirs()
    payload = {
        "company_id": company_id,
        "updated_at": _now(),
        "job_count": len(jobs),
        "meta": meta or {},
        "jobs": jobs,
    }
    with _lock:
        inventory_path(company_id).write_text(json.dumps(payload), encoding="utf-8")


def load_inventory(company_id: str) -> list[dict[str, Any]]:
    path = inventory_path(company_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        jobs = data.get("jobs") or []
        return jobs if isinstance(jobs, list) else []
    except Exception:
        return []


def load_all_inventory() -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for entry in load_companies():
        jobs.extend(load_inventory(company_key(entry)))
    return jobs


def empty_checkpoint(companies: list[dict[str, str]] | None = None) -> dict[str, Any]:
    entries = companies if companies is not None else load_companies()
    return {
        "run_id": hashlib.sha1(_now().encode()).hexdigest()[:10],
        "status": "idle",
        "started_at": None,
        "updated_at": _now(),
        "finished_at": None,
        "cursor": 0,
        "total": len(entries),
        "done": 0,
        "failed": 0,
        "current": None,
        "message": "Idle",
        "companies": [
            {
                "id": company_key(entry),
                "name": entry.get("name") or entry.get("slug") or "company",
                "status": "pending",
                "jobs": 0,
                "error": None,
                "finished_at": None,
            }
            for entry in entries
        ],
    }


def load_checkpoint() -> dict[str, Any]:
    ensure_dirs()
    with _lock:
        if not CHECKPOINT_PATH.exists():
            cp = empty_checkpoint()
            CHECKPOINT_PATH.write_text(json.dumps(cp, indent=2), encoding="utf-8")
            return cp
        try:
            return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
        except Exception:
            cp = empty_checkpoint()
            CHECKPOINT_PATH.write_text(json.dumps(cp, indent=2), encoding="utf-8")
            return cp


def save_checkpoint(checkpoint: dict[str, Any]) -> None:
    ensure_dirs()
    checkpoint["updated_at"] = _now()
    with _lock:
        CHECKPOINT_PATH.write_text(json.dumps(checkpoint, indent=2), encoding="utf-8")


def progress_view(checkpoint: dict[str, Any] | None = None) -> dict[str, Any]:
    cp = checkpoint or load_checkpoint()
    total = max(1, int(cp.get("total") or 0) or 1)
    done = int(cp.get("done") or 0)
    failed = int(cp.get("failed") or 0)
    processed = done + failed
    percent = min(100, round(100 * processed / total)) if cp.get("total") else 0
    return {
        "run_id": cp.get("run_id"),
        "status": cp.get("status"),
        "started_at": cp.get("started_at"),
        "updated_at": cp.get("updated_at"),
        "finished_at": cp.get("finished_at"),
        "current": cp.get("current"),
        "message": cp.get("message"),
        "total": cp.get("total") or 0,
        "done": done,
        "failed": failed,
        "pending": max(0, (cp.get("total") or 0) - processed),
        "percent": percent,
        "can_resume": cp.get("status") in {"failed", "paused"} and any(
            c.get("status") == "pending" for c in cp.get("companies") or []
        ),
        "companies": cp.get("companies") or [],
    }

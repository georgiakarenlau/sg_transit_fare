"""
Bus Finder — find services running between two stops, fetch live arrival times.

Data sources:
    LTA DataMall /BusRoutes     — full route table (~30 000 rows), cached in memory
    LTA DataMall /BusArrivalv2  — real-time arrivals, fetched live per request
"""

import asyncio
import os
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

LTA_BASE = "https://datamall2.mytransport.sg/ltaodataservice"

_routes_cache: list[dict] | None = None
_routes_lock = asyncio.Lock()


def _headers() -> dict:
    return {"AccountKey": os.getenv("LTA_API_KEY", ""), "accept": "application/json"}


async def fetch_all_bus_routes() -> list[dict]:
    """
    Fetch the full LTA bus route table and cache it.

    The dataset has ~30 000 rows across ~60 paginated requests — the first
    call takes 15–30 s.  All subsequent calls return the in-memory cache
    instantly.  The server pre-warms this cache on startup so real users
    rarely see the delay.
    """
    global _routes_cache
    async with _routes_lock:
        if _routes_cache is not None:
            return _routes_cache

        routes: list[dict] = []
        skip = 0
        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                r = await client.get(
                    f"{LTA_BASE}/BusRoutes",
                    headers=_headers(),
                    params={"$skip": skip},
                )
                r.raise_for_status()
                batch = r.json().get("value", [])
                if not batch:
                    break
                routes.extend(batch)
                skip += 500

        _routes_cache = routes
    return _routes_cache


def _bus_sort_key(svc_no: str) -> tuple:
    """Sort bus numbers numerically where possible: 1, 2, … 153, NR1, NR3."""
    digits = "".join(c for c in svc_no if c.isdigit())
    return (int(digits) if digits else 999_999, svc_no)


async def find_services_between(stop_a: str, stop_b: str) -> list[str]:
    """
    Return sorted bus service numbers that call at both stop_a and stop_b,
    with stop_a appearing *earlier* in the route sequence than stop_b
    (i.e. the bus travels from A toward B, not the reverse).
    """
    routes = await fetch_all_bus_routes()

    # Build (ServiceNo, Direction) → {BusStopCode: StopSequence}
    svc_stops: dict[tuple, dict[str, int]] = defaultdict(dict)
    for row in routes:
        key = (row["ServiceNo"], row["Direction"])
        svc_stops[key][row["BusStopCode"]] = row["StopSequence"]

    found: set[str] = set()
    for (svc_no, _), stops in svc_stops.items():
        seq_a = stops.get(stop_a)
        seq_b = stops.get(stop_b)
        if seq_a is not None and seq_b is not None and seq_a < seq_b:
            found.add(svc_no)

    return sorted(found, key=_bus_sort_key)


async def get_arrivals_at(stop_code: str, service_nos: list[str]) -> list[dict]:
    """
    Fetch live arrivals from LTA DataMall for the given services at stop_code.

    Returns one entry per service number (even services not currently running
    get [None, None, None] timing slots).  Results are sorted soonest-first.
    """
    now_sg = datetime.now(ZoneInfo("Asia/Singapore"))
    service_set = set(service_nos)

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{LTA_BASE}/BusArrivalv2",
            headers=_headers(),
            params={"BusStopCode": stop_code},
        )
        r.raise_for_status()

    # Parse arrival times from the LTA response
    live: dict[str, list[int | None]] = {}
    for svc in r.json().get("Services", []):
        if svc["ServiceNo"] not in service_set:
            continue
        timings: list[int | None] = []
        for slot in ("NextBus", "NextBus2", "NextBus3"):
            eta_str = svc.get(slot, {}).get("EstimatedArrival", "")
            if not eta_str:
                timings.append(None)
                continue
            try:
                eta = datetime.fromisoformat(eta_str)
                mins = round((eta - now_sg).total_seconds() / 60)
                timings.append(max(0, mins))
            except ValueError:
                timings.append(None)
        live[svc["ServiceNo"]] = timings

    # Build a result row for every matched service (not just ones with live data)
    results = [
        {"bus_number": svc_no, "arrivals": live.get(svc_no, [None, None, None])}
        for svc_no in service_nos
    ]

    # Sort: buses with a real arrival first, then by how soon they arrive
    results.sort(key=lambda x: (x["arrivals"][0] is None, x["arrivals"][0] or 999))
    return results

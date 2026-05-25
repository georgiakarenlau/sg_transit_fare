"""
LTA DataMall bus stop directory — cached in memory, searched by name/road/code.

The full dataset (~5 000 stops, paginated 500 per page) is fetched once on
first use and reused for all subsequent requests.
"""

import asyncio
import os

import httpx

LTA_BASE = "https://datamall2.mytransport.sg/ltaodataservice"

_stops_cache: list[dict] | None = None
_stops_lock = asyncio.Lock()


def _headers() -> dict:
    return {"AccountKey": os.getenv("LTA_API_KEY", ""), "accept": "application/json"}


async def fetch_all_bus_stops() -> list[dict]:
    """
    Fetch every bus stop from LTA DataMall and cache the result in memory.
    Subsequent calls return immediately from cache.
    """
    global _stops_cache
    async with _stops_lock:
        if _stops_cache is not None:
            return _stops_cache

        stops: list[dict] = []
        skip = 0
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                r = await client.get(
                    f"{LTA_BASE}/BusStops",
                    headers=_headers(),
                    params={"$skip": skip},
                )
                r.raise_for_status()
                batch = r.json().get("value", [])
                if not batch:
                    break
                stops.extend(batch)
                skip += 500

        _stops_cache = stops
    return _stops_cache


async def search_stops(query: str, limit: int = 10) -> list[dict]:
    """
    Return up to `limit` stops whose bus stop code, description, or road name
    contains `query` (case-insensitive).  Exact code matches are returned first.
    """
    q = query.strip().upper()
    all_stops = await fetch_all_bus_stops()

    exact: list[dict] = []
    fuzzy: list[dict] = []

    for s in all_stops:
        code = s.get("BusStopCode", "")
        name = s.get("Description", "").upper()
        road = s.get("RoadName", "").upper()
        entry = {"code": code, "name": s["Description"], "road": s["RoadName"]}

        if q == code:
            exact.append(entry)
        elif q in code or q in name or q in road:
            fuzzy.append(entry)

        if len(exact) + len(fuzzy) >= limit * 2:
            break

    return (exact + fuzzy)[:limit]

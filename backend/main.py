"""
Singapore Public Transport Fare Calculator — FastAPI Backend

Endpoints:
    GET /api/routes?from=LOCATION&to=LOCATION
        Returns up to 3 public transport routes between two Singapore locations,
        each with the calculated adult EZ-Link card fare.

    GET /health
        Simple liveness check.

Setup:
    1. Create backend/.env with:
           ONEMAP_EMAIL=your@email.com
           ONEMAP_PASSWORD=yourpassword
    2. pip install fastapi uvicorn httpx python-dotenv
    3. uvicorn main:app --reload  (run from the backend/ directory)

OneMap API used:
    Auth:    POST https://www.onemap.gov.sg/api/auth/post/getToken
    Search:  GET  https://www.onemap.gov.sg/api/common/elastic/search
    Routing: GET  https://www.onemap.gov.sg/api/public/routingsvc/route
"""

import asyncio
import math
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from fare_calculator import JourneyType, calculate_fare

# ──────────────────────────────────────────────────────────────────────────────
# Geometry helpers
# ──────────────────────────────────────────────────────────────────────────────

# OTP's MRT/LRT track distances are the physical rail geometry, which is
# consistently ~30% longer than LTA's internal fare-distance table.
# Using haversine × this factor gives results that match the LTA fare calculator.
_MRT_SINUOSITY = 1.17

# Bus: when OTP's distance is within 15% of straight-line (haversine), it is
# likely using stop-to-stop straight lines rather than real road geometry.
# In that case we apply a road-sinuosity correction instead of trusting OTP.
_BUS_SHAPE_THRESHOLD = 1.15   # OTP/haversine ratio below which we correct
_BUS_SINUOSITY       = 1.20   # road-distance ≈ haversine × this factor for SG buses


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two lat/lon points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _decode_polyline(encoded: str) -> list[list[float]]:
    """
    Decode a Google-encoded polyline string into [[lat, lon], …] pairs.
    OTP stores leg geometry in this format under legGeometry.points.
    """
    coords: list[list[float]] = []
    index = lat = lng = 0
    while index < len(encoded):
        val = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            val |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += ~(val >> 1) if val & 1 else val >> 1
        val = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            val |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += ~(val >> 1) if val & 1 else val >> 1
        coords.append([lat * 1e-5, lng * 1e-5])
    return coords

load_dotenv()

app = FastAPI(
    title="Singapore Transport Fare Calculator",
    description="Routes via OneMap + LTA distance-based EZ-Link fares",
    version="1.0.0",
)

# Allow all origins for local development — restrict this for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# OneMap authentication
# ──────────────────────────────────────────────────────────────────────────────

import logging

ONEMAP_BASE = "https://www.onemap.gov.sg/api"
_ONEMAP_EMAIL = os.getenv("ONEMAP_EMAIL")
_ONEMAP_PASSWORD = os.getenv("ONEMAP_PASSWORD")


async def _get_token() -> str:
    """Fetch a fresh OneMap Bearer token on every call (tokens expire every 3 days)."""
    if not _ONEMAP_EMAIL or not _ONEMAP_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Server misconfiguration: ONEMAP_EMAIL / ONEMAP_PASSWORD not set in environment.",
        )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{ONEMAP_BASE}/auth/post/getToken",
                json={"email": _ONEMAP_EMAIL, "password": _ONEMAP_PASSWORD},
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        logging.error("OneMap auth failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="OneMap authentication failed — check your credentials.",
        )

    token = data.get("access_token")
    if not token:
        logging.error("OneMap auth response missing access_token: %s", data)
        raise HTTPException(
            status_code=502,
            detail="OneMap authentication failed — check your credentials.",
        )
    return token


# ──────────────────────────────────────────────────────────────────────────────
# OneMap helper functions
# ──────────────────────────────────────────────────────────────────────────────

async def _raw_search(query: str) -> list[dict]:
    """Call OneMap elastic search and return the results list (may be empty)."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{ONEMAP_BASE}/common/elastic/search",
            params={"searchVal": query, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1},
        )
        resp.raise_for_status()
    return resp.json().get("results", [])


# Common transit-specific suffixes that OneMap often omits from its index.
# We strip these one at a time and retry the search if the first attempt fails.
_TRANSIT_SUFFIXES = [
    " MRT STATION", " MRT INTERCHANGE", " MRT",
    " LRT STATION", " LRT",
    " BUS TERMINAL", " BUS INTERCHANGE", " BUS HUB",
    " STATION", " INTERCHANGE", " TERMINAL",
]


_TRANSIT_KEYWORDS = {"MRT", "LRT", "STATION", "INTERCHANGE", "TERMINAL", "STOP"}

# These words signal the result is likely an actual transit stop in OneMap's DB.
_STOP_MARKERS = {"MRT STATION", "MRT INTERCHANGE", "LRT STATION", "BUS TERMINAL",
                 "BUS INTERCHANGE", "STATION EXIT"}


def _result_score(result: dict, base_name: str) -> int:
    """
    Score a OneMap search result for transit relevance (higher = better).

    Rules (applied in order, scores are additive):
      +3  SEARCHVAL contains a strong stop-marker ("MRT STATION", "LRT STATION" …)
      +1  SEARCHVAL or BUILDING contains any transit keyword
      +1  SEARCHVAL contains the base location name (e.g. "COMMONWEALTH")
    """
    searchval = result.get("SEARCHVAL", "").upper()
    building  = result.get("BUILDING",  "").upper()
    combined  = searchval + " " + building

    score = 0
    if any(m in combined for m in _STOP_MARKERS):
        score += 3
    if any(kw in combined for kw in _TRANSIT_KEYWORDS):
        score += 1
    if base_name and base_name in combined:
        score += 1
    return score


def _pick_best_result(results: list[dict], original_query: str) -> dict:
    """
    Return the most location-relevant OneMap result.

    For transit queries (containing MRT/LRT/STATION …), score every candidate
    and pick the highest scorer.  The key case this fixes: searching
    "COMMONWEALTH MRT" may return many "Commonwealth Avenue" addresses before
    "COMMONWEALTH MRT STATION" — scoring surfaces the station entry even when
    it isn't first in the list.
    """
    query_upper = original_query.strip().upper()
    is_transit_query = any(kw in query_upper for kw in _TRANSIT_KEYWORDS)

    if not is_transit_query:
        return results[0]

    # Derive a clean base name by stripping mode words so we can match
    # "COMMONWEALTH" inside "COMMONWEALTH MRT STATION".
    base = query_upper
    for kw in ("MRT STATION", "MRT INTERCHANGE", "LRT STATION", "LRT",
               "MRT", "STATION", "INTERCHANGE", "TERMINAL"):
        base = base.replace(kw, "")
    base = base.strip()

    return max(results, key=lambda r: _result_score(r, base))


async def _geocode(location: str) -> tuple[float, float]:
    """
    Convert a free-text Singapore location to (latitude, longitude).

    Search strategy (each step only runs if the previous returned nothing):
      1. "<QUERY> STATION"  — e.g. "COMMONWEALTH MRT STATION" (most precise)
      2. "<QUERY>"          — bare uppercased query
      3. suffix-stripped    — strip "MRT", "LRT", etc. one at a time
    For each non-empty result set, score and return the best match.
    """
    upper = location.strip().upper()

    # Build an ordered list of search terms, most specific first.
    candidates: list[str] = []
    needs_station = (
        ("MRT" in upper or "LRT" in upper)
        and "STATION" not in upper
        and "INTERCHANGE" not in upper
    )
    if needs_station:
        candidates.append(upper + " STATION")     # "COMMONWEALTH MRT STATION"
    candidates.append(upper)                       # "COMMONWEALTH MRT"

    results: list[dict] = []
    for candidate in candidates:
        results = await _raw_search(candidate)
        if results:
            break

    # Suffix-stripping fallback (broadens the search when query is too specific).
    if not results:
        for suffix in _TRANSIT_SUFFIXES:
            if upper.endswith(suffix):
                stripped = upper[: -len(suffix)].strip()
                results = await _raw_search(stripped)
                if results:
                    break

    if not results:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Location not found: '{location}'. "
                "Try a postal code or the full station name, "
                "e.g. 'Commonwealth MRT Station' or '150001'."
            ),
        )

    best = _pick_best_result(results, location)
    return float(best["LATITUDE"]), float(best["LONGITUDE"])


def _get_routing_now() -> datetime:
    """
    Return the Singapore-local datetime to use for routing.

    During late night (22:00–05:59) snaps to 14:00 so OTP plans against a
    full daytime timetable when most buses and trains aren't running.
    """
    now_sg = datetime.now(ZoneInfo("Asia/Singapore"))
    if now_sg.hour >= 22 or now_sg.hour < 6:
        now_sg = now_sg.replace(hour=14, minute=0, second=0, microsecond=0)
    return now_sg


async def _fetch_routes(
    start_lat: float,
    start_lon: float,
    end_lat: float,
    end_lon: float,
    token: str,
    num_itineraries: int,
    mode: str = "transit",
    max_walk: int = 1000,
) -> dict:
    """
    Call the OneMap public transport routing API and return the raw response.

    OneMap's PT planner uses date + time to look up live timetable data,
    so we pass the current date and time.

    mode: "transit" (all modes) | "bus" (bus-only) | "rail" (MRT/LRT-only)
    """
    now_sg   = _get_routing_now()
    today    = now_sg.strftime("%m-%d-%Y")   # MM-DD-YYYY
    now_time = now_sg.strftime("%H:%M:%S")   # HH:MM:SS

    params = {
        "start": f"{start_lat},{start_lon}",
        "end": f"{end_lat},{end_lon}",
        "routeType": "pt",
        "date": today,
        "time": now_time,
        "mode": mode.upper(),   # OneMap requires uppercase: TRANSIT / BUS / RAIL
        "maxWalkDistance": max_walk,
        "numItineraries": num_itineraries,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{ONEMAP_BASE}/public/routingsvc/route",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
        )

        if not resp.is_success:
            body = resp.text[:400]
            if resp.status_code == 404:
                raise HTTPException(
                    status_code=404,
                    detail=f"No PT routes found between these coordinates. OneMap said: {body}",
                )
            raise HTTPException(
                status_code=502,
                detail=f"OneMap routing returned {resp.status_code}: {body}",
            )

    data = resp.json()
    if "error" in data:
        logging.error("OneMap routing error response (mode=%s): %s", mode, data)
        raise HTTPException(
            status_code=502,
            detail=f"OneMap routing error: {data['error']}",
        )
    return data


# ──────────────────────────────────────────────────────────────────────────────
# Response schema
# ──────────────────────────────────────────────────────────────────────────────

class LatLon(BaseModel):
    lat: float
    lon: float


class RouteLeg(BaseModel):
    mode: str
    route: Optional[str]
    from_stop: str
    to_stop: str
    duration_minutes: float
    distance_km: float
    geometry: list[list[float]] = []


class FareInfo(BaseModel):
    fare_sgd: float             # e.g. 1.47
    fare_cents: int             # e.g. 147  (integer — authoritative value)
    journey_type: str           # "MRT" | "Bus" | "Integrated"
    transit_distance_km: float  # Distance used for the fare calculation


class Route(BaseModel):
    duration_minutes: float
    transfers: int
    walk_distance_km: float
    fare: FareInfo
    legs: list[RouteLeg]


class RoutesResponse(BaseModel):
    from_location: str
    to_location: str
    from_coords: LatLon
    to_coords: LatLon
    routes: list[Route]


# ──────────────────────────────────────────────────────────────────────────────
# Itinerary parsing helpers
# ──────────────────────────────────────────────────────────────────────────────

def _itinerary_fingerprint(itinerary: dict) -> str:
    """
    Stable string that identifies a route by its transit legs.
    Used to deduplicate itineraries returned from parallel mode requests.
    Walking legs are ignored since their details can differ slightly
    between transit and bus mode responses.
    """
    parts = []
    for leg in itinerary.get("legs", []):
        mode = leg.get("mode", "WALK")
        if mode == "WALK":
            continue
        route    = leg.get("route") or leg.get("routeId") or ""
        from_stp = leg.get("from", {}).get("name", "")
        to_stp   = leg.get("to",   {}).get("name", "")
        parts.append(f"{mode}|{route}|{from_stp}|{to_stp}")
    return "::".join(parts)



def _classify_journey(legs: list[dict]) -> JourneyType:
    """
    Determine JourneyType from the set of transit modes used.

    OneMap uses "SUBWAY" for MRT/LRT and "BUS" for buses.
    Any combination with SUBWAY is treated as Integrated.
    """
    modes = {leg["mode"] for leg in legs if leg["mode"] != "WALK"}
    if "SUBWAY" in modes or "TRAM" in modes:
        return JourneyType.INTEGRATED if "BUS" in modes else JourneyType.MRT
    return JourneyType.BUS


def _compute_fare_distance_m(raw_legs: list[dict]) -> float:
    """
    Compute total transit distance in metres for LTA fare purposes.

    BUS legs: OTP distance is accurate (GTFS bus route data matches LTA).

    MRT/LRT (SUBWAY/TRAM) legs:
      - Single leg (no line transfer): OTP distance matches LTA's value exactly.
      - Consecutive legs (MRT line transfer at interchange): OTP sums the physical
        track geometry of each sub-leg, which exceeds LTA's integrated entry-to-exit
        fare distance.  Fix: use haversine(first boarding, last alighting) × sinuosity.
        Short intra-station walks (< 200 m) between SUBWAY legs are treated as
        platform transfers, not as breaks in the MRT journey.

    WALK legs are never included in fare distance.
    """
    total_m = 0.0
    i = 0

    while i < len(raw_legs):
        mode = raw_legs[i].get("mode", "WALK")

        if mode == "WALK":
            i += 1
            continue

        if mode in ("SUBWAY", "TRAM"):
            # Collect consecutive SUBWAY/TRAM legs (possibly bridged by short walks).
            run: list[dict] = [raw_legs[i]]
            j = i + 1
            while j < len(raw_legs):
                nm = raw_legs[j].get("mode", "WALK")
                if nm in ("SUBWAY", "TRAM"):
                    run.append(raw_legs[j])
                    j += 1
                elif nm == "WALK" and raw_legs[j].get("distance", 9999) < 200:
                    j += 1   # intra-station platform walk — keep extending the run
                else:
                    break

            if len(run) == 1:
                # Single-line journey: OTP distance already matches LTA.
                total_m += run[0].get("distance", 0.0)
            else:
                # Multi-line transfer: haversine(entry → exit) × sinuosity avoids
                # OTP's per-leg track-geometry inflation.
                first = run[0].get("from", {})
                last  = run[-1].get("to",   {})
                lat1, lon1 = first.get("lat"), first.get("lon")
                lat2, lon2 = last.get("lat"),  last.get("lon")
                if None not in (lat1, lon1, lat2, lon2):
                    total_m += _haversine_km(lat1, lon1, lat2, lon2) * _MRT_SINUOSITY * 1000
                else:
                    total_m += sum(leg.get("distance", 0.0) for leg in run)

            i = j

        else:
            # BUS (or other transit): apply adaptive correction for GTFS quality.
            # OTP falls back to summing stop-to-stop straight lines when a route
            # lacks shape data, producing distances shorter than the real road path.
            # Detect this by comparing OTP's value to the haversine between the
            # boarding and alighting stops: if the ratio is < _BUS_SHAPE_THRESHOLD
            # (≤ 15% above straight-line), OTP has no useful shape data and we
            # apply a road-sinuosity correction instead.
            leg = raw_legs[i]
            leg_dist_m = leg.get("distance", 0.0)
            from_info  = leg.get("from", {})
            to_info    = leg.get("to",   {})
            lat1, lon1 = from_info.get("lat"), from_info.get("lon")
            lat2, lon2 = to_info.get("lat"),   to_info.get("lon")

            if None not in (lat1, lon1, lat2, lon2) and leg_dist_m > 0:
                hav_m = _haversine_km(lat1, lon1, lat2, lon2) * 1000
                if hav_m > 0 and leg_dist_m / hav_m < _BUS_SHAPE_THRESHOLD:
                    total_m += hav_m * _BUS_SINUOSITY
                else:
                    total_m += leg_dist_m
            else:
                total_m += leg_dist_m
            i += 1

    return total_m


def _parse_itinerary(itinerary: dict) -> Route:
    """Convert a single OneMap itinerary dict into our Route response model."""
    raw_legs = itinerary.get("legs", [])

    parsed_legs: list[RouteLeg] = []
    transit_distance_m = _compute_fare_distance_m(raw_legs)

    for leg in raw_legs:
        mode      = leg.get("mode", "WALK")
        distance_m = leg.get("distance", 0.0)
        duration_s = leg.get("duration", 0.0)
        from_info  = leg.get("from", {})
        to_info    = leg.get("to",   {})

        route_label = leg.get("route") or leg.get("routeId") or None

        encoded_geom = leg.get("legGeometry", {}).get("points", "")
        try:
            geometry = _decode_polyline(encoded_geom) if encoded_geom else []
        except Exception:
            geometry = []

        parsed_legs.append(RouteLeg(
            mode=mode,
            route=route_label,
            from_stop=from_info.get("name", ""),
            to_stop=to_info.get("name", ""),
            duration_minutes=round(duration_s / 60, 1),
            distance_km=round(distance_m / 1000, 3),
            geometry=geometry,
        ))

    journey_type = _classify_journey(raw_legs)
    transit_distance_km = transit_distance_m / 1000

    # Guard against edge case where API returns zero transit distance.
    fare_distance_km = max(transit_distance_km, 0.1)
    fare = calculate_fare(fare_distance_km, journey_type)

    return Route(
        duration_minutes=round(itinerary.get("duration", 0) / 60, 1),
        transfers=itinerary.get("transfers", 0),
        walk_distance_km=round(itinerary.get("walkDistance", 0) / 1000, 3),
        fare=FareInfo(
            fare_sgd=fare.fare_sgd,
            fare_cents=fare.fare_cents,
            journey_type=fare.journey_type.value,
            transit_distance_km=fare.distance_km,
        ),
        legs=parsed_legs,
    )


# ──────────────────────────────────────────────────────────────────────────────
# API endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/api/routes", response_model=RoutesResponse, summary="Get PT routes with fares")
async def get_routes(
    from_location: str = Query(
        ...,
        alias="from",
        description="Starting location (name, address, or postal code)",
        example="Orchard MRT Station",
    ),
    to_location: str = Query(
        ...,
        alias="to",
        description="Destination location (name, address, or postal code)",
        example="Changi Airport Terminal 3",
    ),
):
    """
    Return public transport routes between two Singapore locations.

    Each route includes:
    - Walking + transit legs with modes (BUS / SUBWAY / WALK)
    - Adult EZ-Link fare in both SGD and cents
    - Total duration and transfer count

    **Example request:**
    ```
    GET /api/routes?from=Orchard+MRT&to=Changi+Airport
    ```
    """
    if from_location.strip().lower() == to_location.strip().lower():
        raise HTTPException(status_code=400, detail="Origin and destination must be different.")

    # --- Step 1: authenticate + geocode both locations in parallel ---
    try:
        token, (from_lat, from_lon), (to_lat, to_lon) = await asyncio.gather(
            _get_token(),
            _geocode(from_location),
            _geocode(to_location),
        )
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"OneMap API error: {exc.response.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach OneMap API: {exc}")

    coords = f"(A={from_lat:.5f},{from_lon:.5f} B={to_lat:.5f},{to_lon:.5f})"

    # --- Step 2: fetch routing data (three modes in parallel) ---
    # "transit"  — all-mode routes (typically speed-optimised by OneMap)
    # "bus"      — bus-only routes, often cheaper for shorter journeys
    # "rail"     — MRT/LRT-only routes, fewest transfers, different fare profile
    # Combining all three gives up to 9 unique itineraries for the optimiser.
    try:
        raw_results = await asyncio.gather(
            _fetch_routes(from_lat, from_lon, to_lat, to_lon, token,
                          num_itineraries=3, mode="transit", max_walk=1000),
            _fetch_routes(from_lat, from_lon, to_lat, to_lon, token,
                          num_itineraries=3, mode="bus",     max_walk=1000),
            _fetch_routes(from_lat, from_lon, to_lat, to_lon, token,
                          num_itineraries=3, mode="rail",    max_walk=1000),
            _fetch_routes(from_lat, from_lon, to_lat, to_lon, token,
                          num_itineraries=3, mode="transit", max_walk=500),
            return_exceptions=True,
        )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach OneMap routing service: {exc}")

    # --- Step 3: combine, deduplicate, then group by structure ---
    unique_itineraries: list[dict] = []
    seen_exact: set[str] = set()
    first_error: HTTPException | None = None

    for result in raw_results:
        if isinstance(result, HTTPException):
            if first_error is None:
                first_error = result
            continue
        if isinstance(result, Exception):
            continue
        for it in result.get("plan", {}).get("itineraries", []):
            fp = _itinerary_fingerprint(it)
            if fp not in seen_exact:
                seen_exact.add(fp)
                unique_itineraries.append(it)

    if not unique_itineraries:
        detail = (first_error.detail if first_error
                  else "No public transport routes found between these locations.")
        raise HTTPException(
            status_code=first_error.status_code if first_error else 404,
            detail=f"{detail} {coords}",
        )

    routes = [_parse_itinerary(it) for it in unique_itineraries]

    return RoutesResponse(
        from_location=from_location,
        to_location=to_location,
        from_coords=LatLon(lat=from_lat, lon=from_lon),
        to_coords=LatLon(lat=to_lat, lon=to_lon),
        routes=routes,
    )


@app.get("/health", summary="Liveness check")
async def health():
    return {"status": "ok"}


@app.get("/api/search", summary="Location autocomplete suggestions")
async def search_locations(
    q: str = Query(..., min_length=2, description="Partial location name to search"),
):
    """
    Return up to 8 OneMap location suggestions for a partial query string.
    Used by the frontend autocomplete on the From / To inputs.

    Example: GET /api/search?q=commonwealth
    """
    results = await _raw_search(q.strip().upper())
    return [
        {
            "name":    r.get("SEARCHVAL", ""),
            "address": r.get("ADDRESS", ""),
            "lat":     float(r["LATITUDE"])  if r.get("LATITUDE")  else None,
            "lon":     float(r["LONGITUDE"]) if r.get("LONGITUDE") else None,
        }
        for r in results[:8]
    ]


@app.get("/api/debug/geocode", summary="Debug: show raw OneMap search results for a location")
async def debug_geocode(q: str = Query(..., description="Location to search")):
    """
    Returns the raw OneMap search hits for a query string.
    Use this to verify that a location resolves to the correct coordinates
    before blaming the router.

    Example: GET /api/debug/geocode?q=Commonwealth+MRT
    """
    upper = q.strip().upper()
    results = await _raw_search(upper)

    # Also try suffix-stripped variants so you can see the fallback in action.
    stripped_results = {}
    for suffix in _TRANSIT_SUFFIXES:
        if upper.endswith(suffix):
            s = upper[: -len(suffix)].strip()
            stripped_results[s] = await _raw_search(s)

    picked = _pick_best_result(results, q) if results else None

    return {
        "query": upper,
        "hit_count": len(results),
        "picked": {
            "name": picked.get("SEARCHVAL") if picked else None,
            "lat": float(picked["LATITUDE"]) if picked else None,
            "lon": float(picked["LONGITUDE"]) if picked else None,
        } if picked else None,
        "top_3_raw": results[:3],
        "suffix_fallbacks": stripped_results,
    }

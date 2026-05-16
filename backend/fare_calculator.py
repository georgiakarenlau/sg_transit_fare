"""
Singapore Adult EZ-Link / SimplyGo Card Fare Calculator

Fare table source: Public Transport Council (PTC)
https://www.ptc.gov.sg/fares/public-transport-fares-and-passes/

Key facts about the current structure:
  - Bus (trunk) and MRT/LRT now use the SAME distance-based fare table.
  - Integrated journeys (bus + MRT transfers within 45 min) use one combined
    fare calculated on the total transit distance — not per-leg.
  - Base fare: $1.28 for up to 3.2 km.  Cap: $2.57 beyond 40.2 km.

Fares are revised periodically. Always verify against the PTC website
before deploying to production.
"""

from dataclasses import dataclass
from enum import Enum


class JourneyType(str, Enum):
    MRT        = "MRT"         # MRT / LRT only
    BUS        = "Bus"         # Bus only
    INTEGRATED = "Integrated"  # Bus + MRT with transfers


@dataclass
class FareResult:
    """Fare breakdown for an adult EZ-Link / SimplyGo card journey."""
    distance_km:  float        # Transit distance used for the fare lookup
    fare_sgd:     float        # Fare in Singapore dollars  (e.g. 1.68)
    fare_cents:   int          # Fare in cents — integer, avoids float rounding
    journey_type: JourneyType


# ──────────────────────────────────────────────────────────────────────────────
# Fare table  (source: PTC, current as of 2025)
# ──────────────────────────────────────────────────────────────────────────────
#
# Format: list of (max_distance_km, fare_in_cents).
# The fare for a journey is the first row where distance <= max_distance_km.
# Journeys beyond 40.2 km are capped at _MAX_FARE_CENTS.
#
# Note: as of the current PTC schedule, bus (trunk) and MRT/LRT share
# identical rates, so a single table covers all modes.

_FARE_TABLE: list[tuple[float, int]] = [
    ( 3.2, 128),   # $1.28
    ( 4.2, 138),   # $1.38
    ( 5.2, 149),   # $1.49
    ( 6.2, 159),   # $1.59
    ( 7.2, 168),   # $1.68
    ( 8.2, 175),   # $1.75
    ( 9.2, 182),   # $1.82
    (10.2, 186),   # $1.86
    (11.2, 190),   # $1.90
    (12.2, 194),   # $1.94
    (13.2, 198),   # $1.98
    (14.2, 202),   # $2.02
    (15.2, 207),   # $2.07
    (16.2, 211),   # $2.11
    (17.2, 215),   # $2.15
    (18.2, 220),   # $2.20
    (19.2, 224),   # $2.24
    (20.2, 227),   # $2.27
    (21.2, 230),   # $2.30
    (22.2, 233),   # $2.33
    (23.2, 236),   # $2.36
    (24.2, 238),   # $2.38
    (25.2, 240),   # $2.40
    (26.2, 242),   # $2.42
    (27.2, 243),   # $2.43
    (28.2, 244),   # $2.44
    (29.2, 245),   # $2.45
    (30.2, 246),   # $2.46
    (31.2, 247),   # $2.47
    (32.2, 248),   # $2.48
    (33.2, 249),   # $2.49
    (34.2, 250),   # $2.50
    (35.2, 251),   # $2.51
    (36.2, 252),   # $2.52
    (37.2, 253),   # $2.53
    (38.2, 254),   # $2.54
    (39.2, 255),   # $2.55
    (40.2, 256),   # $2.56
]

_MAX_FARE_CENTS = 257   # $2.57 — cap for distances over 40.2 km


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────

def _lookup_fare_cents(distance_km: float) -> int:
    """Return the fare in cents for *distance_km* using the PTC fare table."""
    for max_dist, fare_cents in _FARE_TABLE:
        if distance_km <= max_dist:
            return fare_cents
    return _MAX_FARE_CENTS


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def calculate_adult_ezlink_fare(
    distance_km: float,
    journey_type: JourneyType = JourneyType.INTEGRATED,
) -> FareResult:
    """
    Calculate the adult EZ-Link / SimplyGo fare for a Singapore PT journey.

    Args:
        distance_km:  Total *transit* distance in km (walking legs excluded).
                      For integrated journeys use the combined transit distance.
        journey_type: MRT, Bus, or Integrated (default). All modes currently
                      share the same PTC fare table, so this affects display
                      only — it is kept for future-proofing.

    Returns:
        FareResult with the fare in both SGD and cents.

    Raises:
        ValueError: If distance_km is not positive.

    Example:
        >>> result = calculate_adult_ezlink_fare(10.5)
        >>> result.fare_sgd
        1.9
    """
    if distance_km <= 0:
        raise ValueError(f"distance_km must be positive, got {distance_km!r}")

    fare_cents = _lookup_fare_cents(distance_km)

    return FareResult(
        distance_km=round(distance_km, 3),
        fare_sgd=fare_cents / 100,
        fare_cents=fare_cents,
        journey_type=journey_type,
    )

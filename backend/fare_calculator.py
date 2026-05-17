"""
Singapore EZ-Link / SimplyGo Card Fare Calculator

Fare table source: Public Transport Council (PTC)
https://www.ptc.gov.sg/fares/public-transport-fares-and-passes/

Key facts about the current structure:
  - Bus (trunk) and MRT/LRT now use the SAME distance-based fare table.
  - Integrated journeys (bus + MRT transfers within 45 min) use one combined
    fare calculated on the total transit distance — not per-leg.
  - Adult base fare: $1.28 for up to 3.2 km.  Cap: $2.57 beyond 40.2 km.
  - Student/Senior concession fares cap at the 7.2 km band (78¢ / 107¢).

Fares are revised periodically. Always verify against the PTC website
before deploying to production.
"""

from dataclasses import dataclass
from enum import Enum


class JourneyType(str, Enum):
    MRT        = "MRT"         # MRT / LRT only
    BUS        = "Bus"         # Bus only
    INTEGRATED = "Integrated"  # Bus + MRT with transfers


class FareType(str, Enum):
    ADULT   = "adult"
    STUDENT = "student"
    SENIOR  = "senior"


@dataclass
class FareResult:
    """Fare breakdown for a Singapore PT journey."""
    distance_km:  float        # Transit distance used for the fare lookup
    fare_sgd:     float        # Fare in Singapore dollars  (e.g. 1.68)
    fare_cents:   int          # Fare in cents — integer, avoids float rounding
    journey_type: JourneyType
    fare_type:    FareType


# ──────────────────────────────────────────────────────────────────────────────
# Fare tables  (source: PTC, current as of 2025)
# ──────────────────────────────────────────────────────────────────────────────
#
# Format: list of (max_distance_km, fare_in_cents).
# The fare for a journey is the first row where distance <= max_distance_km.
# Journeys beyond the last band use the _MAX_FARE_CENTS cap.
#
# Adult: bus (trunk) and MRT/LRT share identical rates.
# Student / Senior: same table for trunk bus, feeder, and MRT/LRT.
#   Both concession types cap after the 7.2 km band.

_ADULT_FARE_TABLE: list[tuple[float, int]] = [
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
_ADULT_MAX_FARE_CENTS = 257   # $2.57 — cap beyond 40.2 km

_STUDENT_FARE_TABLE: list[tuple[float, int]] = [
    (3.2, 52),   # $0.52
    (4.2, 60),   # $0.60
    (5.2, 66),   # $0.66
    (6.2, 71),   # $0.71
    (7.2, 74),   # $0.74
]
_STUDENT_MAX_FARE_CENTS = 78   # $0.78 — cap beyond 7.2 km

_SENIOR_FARE_TABLE: list[tuple[float, int]] = [
    (3.2,  69),   # $0.69
    (4.2,  79),   # $0.79
    (5.2,  87),   # $0.87
    (6.2,  94),   # $0.94
    (7.2, 100),   # $1.00
]
_SENIOR_MAX_FARE_CENTS = 107   # $1.07 — cap beyond 7.2 km

_TABLES: dict[FareType, tuple[list[tuple[float, int]], int]] = {
    FareType.ADULT:   (_ADULT_FARE_TABLE,   _ADULT_MAX_FARE_CENTS),
    FareType.STUDENT: (_STUDENT_FARE_TABLE, _STUDENT_MAX_FARE_CENTS),
    FareType.SENIOR:  (_SENIOR_FARE_TABLE,  _SENIOR_MAX_FARE_CENTS),
}


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def calculate_fare(
    distance_km: float,
    journey_type: JourneyType = JourneyType.INTEGRATED,
    fare_type: FareType = FareType.ADULT,
) -> FareResult:
    """
    Calculate the EZ-Link / SimplyGo fare for a Singapore PT journey.

    Args:
        distance_km:  Total *transit* distance in km (walking excluded).
                      For integrated journeys use the combined transit distance.
        journey_type: MRT, Bus, or Integrated. All modes share the same PTC
                      fare table so this affects display only.
        fare_type:    ADULT (default), STUDENT, or SENIOR concession.

    Returns:
        FareResult with the fare in both SGD and cents.

    Raises:
        ValueError: If distance_km is not positive.
    """
    if distance_km <= 0:
        raise ValueError(f"distance_km must be positive, got {distance_km!r}")

    table, max_cents = _TABLES[fare_type]
    fare_cents = max_cents
    for max_dist, cents in table:
        if distance_km <= max_dist:
            fare_cents = cents
            break

    return FareResult(
        distance_km=round(distance_km, 3),
        fare_sgd=fare_cents / 100,
        fare_cents=fare_cents,
        journey_type=journey_type,
        fare_type=fare_type,
    )


# Keep old name as an alias so nothing breaks during migration.
def calculate_adult_ezlink_fare(
    distance_km: float,
    journey_type: JourneyType = JourneyType.INTEGRATED,
) -> FareResult:
    return calculate_fare(distance_km, journey_type, FareType.ADULT)

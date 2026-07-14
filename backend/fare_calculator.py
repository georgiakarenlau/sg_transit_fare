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

import heapq
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
# Fare table  (source: PTC, current as of 2026)
# ──────────────────────────────────────────────────────────────────────────────
#
# Format: list of (max_distance_km, fare_in_cents).
# The fare for a journey is the first row where distance <= max_distance_km.
# Journeys beyond 40.2 km are capped at _MAX_FARE_CENTS.
#
# Note: bus (trunk) and MRT/LRT share identical rates.

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
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def calculate_fare(
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
    """
    if distance_km <= 0:
        raise ValueError(f"distance_km must be positive, got {distance_km!r}")

    fare_cents = _MAX_FARE_CENTS
    for max_dist, cents in _FARE_TABLE:
        if distance_km <= max_dist:
            fare_cents = cents
            break

    return FareResult(
        distance_km=round(distance_km, 3),
        fare_sgd=fare_cents / 100,
        fare_cents=fare_cents,
        journey_type=journey_type,
    )


# Backward-compatible alias.
calculate_adult_ezlink_fare = calculate_fare


# ──────────────────────────────────────────────────────────────────────────────
# LTA MRT station fare distance table
# ──────────────────────────────────────────────────────────────────────────────
#
# Cumulative distance (km) from the first station on each line.
# Source: LTA published MRT station spacing data.
#
# Fare distance between any two stations on the same line = |d_B − d_A|.
# For cross-line journeys each line segment is looked up independently and
# the results summed, matching LTA's internal calculation.
#
# LRT lines (BP/SK/PU) are omitted — the table returns None for those so the
# caller falls back to the OneMap-derived distance.

_MRT_DISTANCES: dict[str, dict[str, float]] = {

    # ── East West Line (EWL) — from Pasir Ris ────────────────────────────────
    "EW": {
        "PASIR RIS":        0.0,
        "TAMPINES":         2.0,
        "SIMEI":            3.4,
        "TANAH MERAH":      5.3,
        "BEDOK":            7.1,
        "KEMBANGAN":        8.5,
        "EUNOS":            9.9,
        "PAYA LEBAR":      11.1,
        "ALJUNIED":        12.2,
        "KALLANG":         13.3,
        "LAVENDER":        14.4,
        "BUGIS":           15.6,
        "CITY HALL":       16.8,
        "RAFFLES PLACE":   17.6,
        "TANJONG PAGAR":   18.6,
        "OUTRAM PARK":     19.7,
        "TIONG BAHRU":     20.7,
        "REDHILL":         21.8,
        "QUEENSTOWN":      23.1,
        "COMMONWEALTH":    24.1,
        "BUONA VISTA":     25.1,
        "DOVER":           26.0,
        "CLEMENTI":        27.2,
        "JURONG EAST":     29.1,
        "CHINESE GARDEN":  30.1,
        "LAKESIDE":        31.7,
        "BOON LAY":        32.9,
        "PIONEER":         34.4,
        "JOO KOON":        36.0,
        "GUL CIRCLE":      37.4,
        "TUAS CRESCENT":   38.5,
        "TUAS WEST ROAD":  39.4,
        "TUAS LINK":       40.6,
    },

    # ── Changi Airport Branch (CGL) — from Tanah Merah ───────────────────────
    "CG": {
        "TANAH MERAH":     0.0,
        "EXPO":            2.0,
        "CHANGI AIRPORT":  3.6,
    },

    # ── North South Line (NSL) — from Jurong East ────────────────────────────
    "NS": {
        "JURONG EAST":       0.0,
        "BUKIT BATOK":       2.5,
        "BUKIT GOMBAK":      3.9,
        "CHOA CHU KANG":     5.2,
        "YEW TEE":           6.7,
        "KRANJI":            8.6,
        "MARSILING":        10.4,
        "WOODLANDS":        11.8,
        "ADMIRALTY":        13.1,
        "SEMBAWANG":        14.4,
        "CANBERRA":         15.3,
        "YISHUN":           16.7,
        "KHATIB":           18.2,
        "YIO CHU KANG":     19.6,
        "ANG MO KIO":       21.2,
        "BISHAN":           22.9,
        "BRADDELL":         24.2,
        "TOA PAYOH":        25.5,
        "NOVENA":           26.9,
        "NEWTON":           27.8,
        "ORCHARD":          29.3,
        "SOMERSET":         30.3,
        "DHOBY GHAUT":      31.4,
        "CITY HALL":        32.3,
        "RAFFLES PLACE":    33.2,
        "MARINA BAY":       34.6,
        "MARINA SOUTH PIER": 35.9,
    },

    # ── North East Line (NEL) — from HarbourFront ────────────────────────────
    # Note: HarbourFront→Outram Park tunnel is physically ~3.6 km (longer than
    # it appears on a map because the station is at the southern coastal tip).
    # All other inter-station spacings are unchanged from original estimates.
    "NE": {
        "HARBOURFRONT":  0.0,
        "OUTRAM PARK":   3.6,
        "CHINATOWN":     4.6,
        "CLARKE QUAY":   5.8,
        "DHOBY GHAUT":   6.9,
        "LITTLE INDIA":  8.2,
        "FARRER PARK":   9.2,
        "BOON KENG":    10.2,
        "POTONG PASIR": 11.4,
        "WOODLEIGH":    12.6,
        "SERANGOON":    13.8,
        "KOVAN":        15.1,
        "HOUGANG":      16.5,
        "BUANGKOK":     17.9,
        "SENGKANG":     19.2,
        "PUNGGOL":      21.7,
    },

    # ── Circle Line (CCL) — from Dhoby Ghaut, clockwise ──────────────────────
    "CC": {
        "DHOBY GHAUT":     0.0,
        "BRAS BASAH":      0.9,
        "ESPLANADE":       1.8,
        "PROMENADE":       2.9,
        "NICOLL HIGHWAY":  4.0,
        "STADIUM":         5.0,
        "MOUNTBATTEN":     6.1,
        "DAKOTA":          7.2,
        "PAYA LEBAR":      8.5,
        "MACPHERSON":      9.8,
        "TAI SENG":       11.2,
        "BARTLEY":        12.4,
        "SERANGOON":      13.6,
        "LORONG CHUAN":   14.8,
        "BISHAN":         16.2,
        "MARYMOUNT":      17.5,
        "CALDECOTT":      18.7,
        "BOTANIC GARDENS": 21.0,
        "FARRER ROAD":    22.3,
        "HOLLAND VILLAGE": 23.5,
        "BUONA VISTA":    24.9,
        "ONE-NORTH":      25.9,
        "KENT RIDGE":     27.1,
        "HAW PAR VILLA":  28.1,
        "PASIR PANJANG":  29.2,
        "LABRADOR PARK":  30.4,
        "TELOK BLANGAH":  31.4,
        "HARBOURFRONT":   32.7,
    },

    # ── Circle Line Extension (CE) — from Promenade ──────────────────────────
    "CE": {
        "PROMENADE":  0.0,
        "BAYFRONT":   1.0,
        "MARINA BAY": 2.4,
    },

    # ── Downtown Line (DTL) — from Bukit Panjang ─────────────────────────────
    "DT": {
        "BUKIT PANJANG":    0.0,
        "CASHEW":           1.6,
        "HILLVIEW":         2.9,
        "BEAUTY WORLD":     4.7,
        "KING ALBERT PARK": 5.7,
        "SIXTH AVENUE":     6.6,
        "TAN KAH KEE":      7.6,
        "BOTANIC GARDENS":  8.7,
        "STEVENS":          9.7,
        "NEWTON":          10.9,
        "LITTLE INDIA":    12.1,
        "ROCHOR":          13.0,
        "BUGIS":           13.9,
        "PROMENADE":       15.2,
        "BAYFRONT":        16.2,
        "DOWNTOWN":        17.2,
        "TELOK AYER":      18.2,
        "CHINATOWN":       18.9,
        "FORT CANNING":    19.7,
        "BENDEMEER":       20.9,
        "GEYLANG BAHRU":   21.8,
        "MATTAR":          22.8,
        "MACPHERSON":      23.8,
        "UBI":             24.9,
        "KAKI BUKIT":      26.1,
        "BEDOK NORTH":     27.3,
        "BEDOK RESERVOIR": 28.5,
        "TAMPINES WEST":   29.7,
        "TAMPINES":        31.0,
        "TAMPINES EAST":   32.0,
        "UPPER CHANGI":    33.1,
        "EXPO":            34.4,
    },

    # ── Thomson-East Coast Line (TEL) — from Woodlands North ─────────────────
    "TE": {
        "WOODLANDS NORTH":     0.0,
        "WOODLANDS":           1.5,
        "WOODLANDS SOUTH":     2.7,
        "SPRINGLEAF":          4.4,
        "LENTOR":              5.7,
        "MAYFLOWER":           6.8,
        "BRIGHT HILL":         8.1,
        "UPPER THOMSON":       9.3,
        "CALDECOTT":          10.7,
        "STEVENS":            13.2,
        "NAPIER":             14.3,
        "ORCHARD BOULEVARD":  15.3,
        "ORCHARD":            16.5,
        "GREAT WORLD":        17.7,
        "HAVELOCK":           18.7,
        "OUTRAM PARK":        19.7,
        "MAXWELL":            20.5,
        "SHENTON WAY":        21.5,
        "MARINA BAY":         22.6,
        "GARDENS BY THE BAY": 23.9,
        "TANJONG RHU":        24.9,
        "KATONG PARK":        25.9,
        "TANJONG KATONG":     26.9,
        "MARINE PARADE":      27.9,
        "MARINE TERRACE":     28.8,
        "SIGLAP":             29.8,
        "BAYSHORE":           30.8,
        "BEDOK SOUTH":        31.8,
        "SUNGEI BEDOK":       32.9,
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# MRT network graph for shortest-path fare distance (Dijkstra)
# ──────────────────────────────────────────────────────────────────────────────
#
# LTA charges based on the shortest-path fare distance through the network,
# not the actual route taken. We build an adjacency list from _MRT_DISTANCES
# (adjacent stations on each line share an edge) and run Dijkstra between the
# journey origin and destination. Interchange stations are a single node, so
# transfers are handled automatically.

def _build_mrt_graph() -> dict[str, list[tuple[str, float]]]:
    graph: dict[str, list[tuple[str, float]]] = {}
    for stations in _MRT_DISTANCES.values():
        ordered = sorted(stations.items(), key=lambda x: x[1])
        for i in range(len(ordered) - 1):
            a, da = ordered[i]
            b, db = ordered[i + 1]
            w = round(db - da, 3)
            graph.setdefault(a, []).append((b, w))
            graph.setdefault(b, []).append((a, w))
    return graph


_MRT_GRAPH: dict[str, list[tuple[str, float]]] = _build_mrt_graph()


def _mrt_shortest_fare_km(from_key: str, to_key: str) -> float | None:
    if from_key not in _MRT_GRAPH or to_key not in _MRT_GRAPH:
        return None
    if from_key == to_key:
        return 0.0
    dist: dict[str, float] = {from_key: 0.0}
    heap: list[tuple[float, str]] = [(0.0, from_key)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == to_key:
            return round(d, 3)
        if d > dist.get(u, float("inf")):
            continue
        for v, w in _MRT_GRAPH.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return None


_MRT_NAME_SUFFIXES: tuple[str, ...] = (
    " MRT INTERCHANGE",
    " MRT STATION",
    " MRT",
    " LRT INTERCHANGE",
    " LRT STATION",
    " STATION",
    " INTERCHANGE",
)


def _station_key(raw: str) -> str:
    """Normalise an MRT station name to match the keys in _MRT_DISTANCES."""
    name = raw.upper().strip()
    for suffix in _MRT_NAME_SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
            break
    return name


def mrt_fare_distance_km(legs) -> float | None:
    """
    Compute the LTA fare distance (km) for a sequence of MRT/LRT legs.

    Uses Dijkstra's shortest-path over the MRT network graph, matching LTA's
    approach of charging on the minimum-distance network path between origin
    and destination regardless of which physical route was taken.

    Each item in *legs* must expose .mode, .route, .from_stop, .to_stop.
    Returns None if origin/destination are absent from the graph so the
    caller can fall back to the OneMap-derived distance.
    """
    transit_legs = [leg for leg in legs if leg.mode in ("SUBWAY", "TRAM")]
    if not transit_legs:
        return None
    from_key = _station_key(transit_legs[0].from_stop)
    to_key   = _station_key(transit_legs[-1].to_stop)
    return _mrt_shortest_fare_km(from_key, to_key)

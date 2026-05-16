/**
 * Singapore Transit Fare Calculator — main app component.
 *
 * Layout (top to bottom):
 *   1. Header bar
 *   2. Search panel  — From / To inputs, fare-type selector, Find Routes button
 *   3. Leaflet map   — A / B markers + dashed straight-line route indicator
 *   4. Route cards   — one RouteCard per itinerary returned by the backend
 */

import { useState, useEffect } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup, Polyline, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import RouteCard from './components/RouteCard';
import LocationInput from './components/LocationInput';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:8000';

// Official LTA MRT/LRT line colours.
// Matched against leg.route (uppercased) with includes(), so partial matches work.
const MRT_LINE_COLORS = {
  'NORTH SOUTH LINE':         '#D42E12',   // NSL  — red
  'EAST WEST LINE':           '#009645',   // EWL  — green
  'CIRCLE LINE':              '#FA9E0D',   // CCL  — orange
  'DOWNTOWN LINE':            '#005EC4',   // DTL  — dark blue
  'THOMSON-EAST COAST LINE':  '#9D5B25',   // TEL  — brown
  'NORTH EAST LINE':          '#9900AA',   // NEL  — purple
  // LRT services (keyed by partial route string returned by OTP)
  'BUKIT PANJANG':            '#748477',   // BPL  — grey-green
  'SENGKANG':                 '#9900AA',   // SRL  — NEL purple (interlined)
  'PUNGGOL':                  '#9900AA',   // PRL  — NEL purple (interlined)
};

const _WALK_STYLE = { color: '#94a3b8', weight: 2, dashArray: '5 7', opacity: 0.85 };
const _BUS_STYLE  = { color: '#86efac', weight: 4, opacity: 0.9 };
const _MRT_FALLBACK = { color: '#64748b', weight: 5, opacity: 0.9 };

function getLegStyle(leg) {
  if (leg.mode === 'WALK') return _WALK_STYLE;
  if (leg.mode === 'BUS')  return _BUS_STYLE;
  if (leg.mode === 'SUBWAY' || leg.mode === 'TRAM') {
    const upper = (leg.route ?? '').toUpperCase();
    for (const [key, color] of Object.entries(MRT_LINE_COLORS)) {
      if (upper.includes(key)) return { color, weight: 5, opacity: 0.9 };
    }
    return _MRT_FALLBACK;
  }
  return _BUS_STYLE;
}

const OPTIMIZE_OPTIONS = [
  { key: 'fare',      label: 'Lowest Fare'      },
  { key: 'transfers', label: 'Fewest Transfers'  },
  { key: 'walk',      label: 'Least Walking'     },
];

const BADGE_LABELS = {
  fare:      '★ Best Fare',
  transfers: '★ Fewest Transfers',
  walk:      '★ Least Walking',
};

// Geographic centre of Singapore — used as the map's initial view.
const SG_CENTER = [1.3521, 103.8198];

// ── Map marker icons ──────────────────────────────────────────────────────────
// We use divIcon so Vite doesn't need to resolve Leaflet's default PNG paths.

function makePinIcon(bg, label) {
  return L.divIcon({
    className: '',   // suppress Leaflet's default white-box class
    html: `<div class="map-pin" style="background:${bg}">${label}</div>`,
    iconSize:    [32, 32],
    iconAnchor:  [16, 16],
    popupAnchor: [0, -18],
  });
}

const ICON_A = makePinIcon('#2ecc71', 'A');   // green — origin
const ICON_B = makePinIcon('#C8102E', 'B');   // red   — destination

// ── MapFitter ─────────────────────────────────────────────────────────────────
// Fits the map viewport to a set of [lat, lon] points.
// `fitKey` is a stable string — the effect only re-runs when it changes,
// avoiding a re-fit on every render.

function MapFitter({ points, fitKey }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Search form
  const [fromInput, setFromInput] = useState('');
  const [toInput,   setToInput]   = useState('');
  const [fareType,  setFareType]  = useState('adult');

  // API result + UI state
  const [routeData,    setRouteData]    = useState(null);  // full API response
  const [selectedIdx,  setSelectedIdx]  = useState(0);     // highlighted card index
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [optimizeBy,   setOptimizeBy]   = useState('fare');

  // Map marker coordinates — derived from the API response, not separate state.
  const fromCoords = routeData?.from_coords ?? null;
  const toCoords   = routeData?.to_coords   ?? null;

  // Sorted routes — recomputed whenever routes or optimization criterion changes.
  const sortedRoutes = routeData
    ? [...routeData.routes].sort((a, b) => {
        if (optimizeBy === 'fare')
          return a.fare.adult_ezlink_cents - b.fare.adult_ezlink_cents
              || a.duration_minutes - b.duration_minutes;
        if (optimizeBy === 'transfers')
          return a.transfers - b.transfers
              || a.duration_minutes - b.duration_minutes;
        // walk
        return a.walk_distance_km - b.walk_distance_km
            || a.duration_minutes - b.duration_minutes;
      })
    : [];

  function handleOptimizeBy(key) {
    setOptimizeBy(key);
    setSelectedIdx(0);
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async function handleSearch(e) {
    e.preventDefault();
    const from = fromInput.trim();
    const to   = toInput.trim();
    if (!from || !to) return;

    setLoading(true);
    setError(null);
    setRouteData(null);

    try {
      const { data } = await axios.get(`${API_BASE}/api/routes`, {
        params: { from, to, fare_type: fareType },
      });
      setRouteData(data);
      setSelectedIdx(0);
    } catch (err) {
      if (err.response) {
        // The backend replied with a 4xx / 5xx error.
        setError(err.response.data?.detail ?? 'Failed to fetch routes.');
      } else {
        // Could not reach the backend at all.
        setError(
          'Cannot connect to the backend at http://localhost:8000. '
          + 'Make sure it is running: uvicorn main:app --reload',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-inner">
          <span className="header-logo" aria-hidden="true">🚇</span>
          <h1 className="header-title">Singapore Transit Fares</h1>
        </div>
      </header>

      <main className="app-main">

        {/* ── Search panel ─────────────────────────────────────────────── */}
        <section className="search-panel">
          <form className="search-form" onSubmit={handleSearch}>
            <div className="search-row">

              <LocationInput
                id="inp-from"
                label="From"
                placeholder="e.g. Orchard MRT"
                value={fromInput}
                onChange={setFromInput}
              />

              <LocationInput
                id="inp-to"
                label="To"
                placeholder="e.g. Changi Airport"
                value={toInput}
                onChange={setToInput}
              />

              <div className="input-group input-group--narrow">
                <label htmlFor="fare-type">Fare type</label>
                <select
                  id="fare-type"
                  value={fareType}
                  onChange={e => setFareType(e.target.value)}
                >
                  <option value="adult">Adult</option>
                  <option value="student">Student</option>
                  <option value="senior">Senior</option>
                </select>
              </div>

              <button
                type="submit"
                className="search-btn"
                disabled={loading || !fromInput.trim() || !toInput.trim()}
              >
                {loading ? 'Searching…' : 'Find Routes'}
              </button>

            </div>
          </form>
        </section>

        {/* ── Map ─────────────────────────────────────────────────────── */}
        <section className="map-section">
          <MapContainer center={SG_CENTER} zoom={12} className="leaflet-map">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            />

            {/* ── A / B markers ────────────────────────────────────────── */}
            {fromCoords && (
              <Marker position={[fromCoords.lat, fromCoords.lon]} icon={ICON_A}>
                <Popup><strong>A</strong> — {routeData.from_location}</Popup>
              </Marker>
            )}
            {toCoords && (
              <Marker position={[toCoords.lat, toCoords.lon]} icon={ICON_B}>
                <Popup><strong>B</strong> — {routeData.to_location}</Popup>
              </Marker>
            )}

            {/* ── Route polylines for the selected option ───────────────── */}
            {(() => {
              const route = sortedRoutes[selectedIdx];
              if (!route) return null;

              // Collect all geometry points for map fitting.
              const allPts = route.legs.flatMap(leg => leg.geometry);
              const fitKey = `${routeData?.from_location}-${routeData?.to_location}-${selectedIdx}-${optimizeBy}`;

              return (
                <>
                  {route.legs.map((leg, i) => {
                    if (leg.geometry.length < 2) return null;
                    return (
                      <Polyline
                        key={i}
                        positions={leg.geometry}
                        pathOptions={getLegStyle(leg)}
                      />
                    );
                  })}
                  {allPts.length >= 2 && (
                    <MapFitter points={allPts} fitKey={fitKey} />
                  )}
                </>
              );
            })()}

            {/* Fallback fit when there are coords but no route yet */}
            {sortedRoutes.length === 0 && fromCoords && toCoords && (
              <MapFitter
                points={[[fromCoords.lat, fromCoords.lon], [toCoords.lat, toCoords.lon]]}
                fitKey={`${fromCoords.lat}-${toCoords.lat}`}
              />
            )}
          </MapContainer>
        </section>

        {/* ── Route results ─────────────────────────────────────────── */}
        <section className="routes-section">

          {loading && (
            <div className="status status--loading">
              <span className="spinner" aria-hidden="true" />
              Finding routes…
            </div>
          )}

          {error && !loading && (
            <div className="status status--error" role="alert">{error}</div>
          )}

          {!routeData && !loading && !error && (
            <div className="status status--hint">
              Enter a start and end location above, then click <strong>Find Routes</strong>.
            </div>
          )}

          {routeData && !loading && (
            <>
              <div className="routes-heading-row">
                <h2 className="routes-heading">
                  {sortedRoutes.length} route{sortedRoutes.length !== 1 ? 's' : ''} found
                  <span className="routes-subtitle">
                    {routeData.from_location} → {routeData.to_location}
                  </span>
                </h2>

                <div className="optimize-selector">
                  <span className="optimize-label">Optimise by</span>
                  {OPTIMIZE_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`opt-btn${optimizeBy === opt.key ? ' active' : ''}`}
                      onClick={() => handleOptimizeBy(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="route-list">
                {sortedRoutes.map((route, i) => (
                  <RouteCard
                    key={i}
                    route={route}
                    index={i}
                    isSelected={i === selectedIdx}
                    onSelect={() => setSelectedIdx(i)}
                    badge={i === 0 ? BADGE_LABELS[optimizeBy] : null}
                  />
                ))}
              </div>
            </>
          )}

        </section>
      </main>

      <footer className="app-footer">
        Fares are indicative — Adult EZ-Link, 2024 LTA table. Always verify before travel.
      </footer>
    </div>
  );
}

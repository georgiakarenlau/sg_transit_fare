/**
 * Shared leg-detail components used by both RouteCard and MultiStop.
 *
 * Exports:
 *   getMrtColor, getMrtLineName, cleanBusRoute, chipLabel  — pure helpers
 *   BusIcon, WalkIcon                                       — icon components
 *   StopList                                                — vertical stop list
 *   LegDetail                                               — single leg row (clickable)
 */

import { useState } from 'react';

// ── MRT colour maps ───────────────────────────────────────────────────────────

export const MRT_SHORT_COLORS = {
  'NS': '#D42E12', 'EW': '#009645', 'CG': '#009645',
  'CC': '#FA9E0D', 'CE': '#FA9E0D', 'DT': '#005EC4',
  'TE': '#9D5B25', 'NE': '#9900AA', 'BP': '#748477',
  'SK': '#9900AA', 'PU': '#9900AA',
};

export const MRT_CHIP_COLORS = {
  'NORTH SOUTH LINE': '#D42E12', 'EAST WEST LINE': '#009645',
  'CIRCLE LINE': '#FA9E0D',      'DOWNTOWN LINE': '#005EC4',
  'THOMSON-EAST COAST LINE': '#9D5B25', 'NORTH EAST LINE': '#9900AA',
  'BUKIT PANJANG': '#748477',    'SENGKANG': '#9900AA', 'PUNGGOL': '#9900AA',
};

export const MRT_LINE_NAMES = {
  'NS': 'North South Line', 'EW': 'East West Line', 'CG': 'East West Line',
  'CC': 'Circle Line',      'CE': 'Circle Line',    'DT': 'Downtown Line',
  'TE': 'Thomson–East Coast Line', 'NE': 'North East Line',
  'BP': 'Bukit Panjang LRT', 'SK': 'Sengkang LRT', 'PU': 'Punggol LRT',
};

export function getMrtColor(route) {
  const upper = (route ?? '').toUpperCase().trim();
  if (MRT_SHORT_COLORS[upper]) return MRT_SHORT_COLORS[upper];
  for (const [key, color] of Object.entries(MRT_CHIP_COLORS)) {
    if (upper.includes(key)) return color;
  }
  return null;
}

export function getMrtLineName(route) {
  const upper = (route ?? '').toUpperCase().trim();
  return MRT_LINE_NAMES[upper] ?? route ?? 'MRT';
}

export function cleanBusRoute(route) {
  return (route ?? '').replace(/^.*?\bBUS\s+/i, '').trim() || (route ?? '');
}

export function chipLabel(leg) {
  if (leg.mode === 'WALK') return `Walk ${Math.round(leg.duration_minutes)} min`;
  if (leg.mode === 'BUS') {
    const num = cleanBusRoute(leg.route);
    return num ? `Bus ${num}` : 'Bus';
  }
  if (leg.mode === 'SUBWAY' || leg.mode === 'TRAM') return leg.route ?? 'MRT';
  const name = { WALK: 'Walk', BUS: 'Bus', SUBWAY: 'MRT', TRAM: 'LRT' }[leg.mode] ?? leg.mode;
  return leg.route ? `${name} ${leg.route}` : name;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

export const BusIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.78A2.99 2.99 0 0020 16V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1A1.5 1.5 0 117.5 14a1.5 1.5 0 010 3zm9 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM18 11H6V6h12v5z"/>
  </svg>
);

export const WalkIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M13.49 5.48a2 2 0 100-4 2 2 0 000 4zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3a7.02 7.02 0 005.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
  </svg>
);

// ── StopList ──────────────────────────────────────────────────────────────────
// Google Maps-style vertical stop list with connecting line.

export function StopList({ from, stops, to, color }) {
  const all = [from, ...stops, to];
  return (
    <div className="rc-stop-list">
      {all.map((name, i) => {
        const isLast     = i === all.length - 1;
        const isTerminal = i === 0 || isLast;
        return (
          <div key={i} className={`rc-stop-row${isTerminal ? ' rc-stop-row--terminal' : ''}`}>
            <div className="rc-stop-connector">
              <div
                className="rc-stop-dot"
                style={isTerminal
                  ? { background: color }
                  : { background: '#fff', borderColor: color }}
              />
              {!isLast && <div className="rc-stop-line" style={{ background: color }} />}
            </div>
            <span className="rc-stop-name">{name}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── LegDetail ─────────────────────────────────────────────────────────────────
// Single leg row. Transit legs are clickable to reveal intermediate stops.

export function LegDetail({ leg }) {
  const [showStops, setShowStops] = useState(false);

  if (leg.mode === 'WALK') {
    const metres = Math.round(leg.distance_km * 1000);
    const mins   = Math.round(leg.duration_minutes);
    return (
      <div className="rc-dl-leg rc-dl-leg--walk">
        <div className="rc-dl-icon rc-dl-icon--walk"><WalkIcon /></div>
        <div className="rc-dl-body">
          <span className="rc-dl-title rc-dl-title--walk">Walk</span>
          <span className="rc-dl-meta">{metres} m · {mins} min</span>
        </div>
      </div>
    );
  }

  const isMrt     = leg.mode === 'SUBWAY' || leg.mode === 'TRAM';
  const color     = isMrt ? (getMrtColor(leg.route) ?? '#64748b') : '#15803d';
  const code      = (leg.route ?? '').toUpperCase().trim().slice(0, 2);
  const title     = isMrt ? getMrtLineName(leg.route) : `Bus ${cleanBusRoute(leg.route)}`;
  const stopNames = leg.intermediate_stop_names ?? [];
  const stopCount = stopNames.length;
  const mins      = Math.round(leg.duration_minutes);

  function handleClick(e) {
    e.stopPropagation();
    setShowStops(s => !s);
  }

  return (
    <div className="rc-dl-leg rc-dl-leg--clickable" onClick={handleClick}>
      <div className="rc-dl-icon" style={{ background: color }}>
        {isMrt ? <span className="rc-dl-icon-text">{code}</span> : <BusIcon />}
      </div>
      <div className="rc-dl-body">
        <span className="rc-dl-title" style={{ color }}>{title}</span>
        <div className="rc-dl-stops">
          <span className="rc-dl-stop-name">{leg.from_stop}</span>
          <span className="rc-dl-arrow">→</span>
          <span className="rc-dl-stop-name">{leg.to_stop}</span>
        </div>
        <span className="rc-dl-meta">
          {stopCount} stop{stopCount !== 1 ? 's' : ''} · {mins} min
        </span>
        {showStops && (
          <StopList
            from={leg.from_stop}
            stops={stopNames}
            to={leg.to_stop}
            color={color}
          />
        )}
      </div>
      <span className={`rc-dl-chevron${showStops ? ' rc-dl-chevron--up' : ''}`}>▾</span>
    </div>
  );
}

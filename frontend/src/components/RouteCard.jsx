import { useState, useEffect } from 'react';

// ── MRT colour maps ───────────────────────────────────────────────────────────

const MRT_SHORT_COLORS = {
  'NS': '#D42E12',
  'EW': '#009645',
  'CG': '#009645',
  'CC': '#FA9E0D',
  'CE': '#FA9E0D',
  'DT': '#005EC4',
  'TE': '#9D5B25',
  'NE': '#9900AA',
  'BP': '#748477',
  'SK': '#9900AA',
  'PU': '#9900AA',
};

const MRT_CHIP_COLORS = {
  'NORTH SOUTH LINE':        '#D42E12',
  'EAST WEST LINE':          '#009645',
  'CIRCLE LINE':             '#FA9E0D',
  'DOWNTOWN LINE':           '#005EC4',
  'THOMSON-EAST COAST LINE': '#9D5B25',
  'NORTH EAST LINE':         '#9900AA',
  'BUKIT PANJANG':           '#748477',
  'SENGKANG':                '#9900AA',
  'PUNGGOL':                 '#9900AA',
};

const MRT_LINE_NAMES = {
  'NS': 'North South Line',
  'EW': 'East West Line',
  'CG': 'East West Line',
  'CC': 'Circle Line',
  'CE': 'Circle Line',
  'DT': 'Downtown Line',
  'TE': 'Thomson–East Coast Line',
  'NE': 'North East Line',
  'BP': 'Bukit Panjang LRT',
  'SK': 'Sengkang LRT',
  'PU': 'Punggol LRT',
};

function getMrtColor(route) {
  const upper = (route ?? '').toUpperCase().trim();
  if (MRT_SHORT_COLORS[upper]) return MRT_SHORT_COLORS[upper];
  for (const [key, color] of Object.entries(MRT_CHIP_COLORS)) {
    if (upper.includes(key)) return color;
  }
  return null;
}

function getMrtLineName(route) {
  const upper = (route ?? '').toUpperCase().trim();
  return MRT_LINE_NAMES[upper] ?? route ?? 'MRT';
}

function cleanBusRoute(route) {
  return (route ?? '').replace(/^.*?\bBUS\s+/i, '').trim() || (route ?? '');
}

function chipLabel(leg) {
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

const BusIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M4 16c0 .88.39 1.67 1 2.22V20a1 1 0 001 1h1a1 1 0 001-1v-1h8v1a1 1 0 001 1h1a1 1 0 001-1v-1.78A2.99 2.99 0 0020 16V6c0-3.5-3.58-4-8-4S4 2.5 4 6v10zm3.5 1A1.5 1.5 0 117.5 14a1.5 1.5 0 010 3zm9 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM18 11H6V6h12v5z"/>
  </svg>
);

const WalkIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M13.49 5.48a2 2 0 100-4 2 2 0 000 4zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3a7.02 7.02 0 005.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
  </svg>
);

// ── LegDetail ─────────────────────────────────────────────────────────────────

function LegDetail({ leg }) {
  if (leg.mode === 'WALK') {
    const metres = Math.round(leg.distance_km * 1000);
    const mins   = Math.round(leg.duration_minutes);
    return (
      <div className="rc-dl-leg rc-dl-leg--walk">
        <div className="rc-dl-icon rc-dl-icon--walk">
          <WalkIcon />
        </div>
        <div className="rc-dl-body">
          <span className="rc-dl-title rc-dl-title--walk">Walk</span>
          <span className="rc-dl-meta">{metres} m · {mins} min</span>
        </div>
      </div>
    );
  }

  const isMrt  = leg.mode === 'SUBWAY' || leg.mode === 'TRAM';
  const color  = isMrt ? (getMrtColor(leg.route) ?? '#64748b') : '#15803d';
  const code   = (leg.route ?? '').toUpperCase().trim().slice(0, 2);
  const title  = isMrt ? getMrtLineName(leg.route) : `Bus ${cleanBusRoute(leg.route)}`;
  const stops  = leg.intermediate_stops ?? 0;
  const mins   = Math.round(leg.duration_minutes);

  return (
    <div className="rc-dl-leg">
      <div className="rc-dl-icon" style={{ background: color }}>
        {isMrt
          ? <span className="rc-dl-icon-text">{code}</span>
          : <BusIcon />
        }
      </div>
      <div className="rc-dl-body">
        <span className="rc-dl-title" style={{ color }}>{title}</span>
        <div className="rc-dl-stops">
          <span className="rc-dl-stop-name">{leg.from_stop}</span>
          <span className="rc-dl-arrow">→</span>
          <span className="rc-dl-stop-name">{leg.to_stop}</span>
        </div>
        <span className="rc-dl-meta">
          {stops} stop{stops !== 1 ? 's' : ''} · {mins} min
        </span>
      </div>
    </div>
  );
}

// ── RouteCard ─────────────────────────────────────────────────────────────────

export default function RouteCard({ route, index, isSelected, onSelect, badge }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isSelected) setExpanded(false);
  }, [isSelected]);

  function handleClick() {
    if (!isSelected) {
      onSelect();
      setExpanded(true);
    } else {
      setExpanded(e => !e);
    }
  }

  const fare     = route.fare.fare_sgd.toFixed(2);
  const duration = Math.round(route.duration_minutes);
  const { transfers, legs, fare: fareInfo } = route;

  const transferLabel =
    transfers === 0 ? 'Direct' : `${transfers} transfer${transfers !== 1 ? 's' : ''}`;

  return (
    <div
      className={`route-card${isSelected ? ' selected' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
      aria-pressed={isSelected}
      aria-expanded={expanded}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="rc-header">
        <div className="rc-meta">
          <span className="rc-option">Option {index + 1}</span>
          {badge && <span className="rc-badge rc-badge--best">{badge}</span>}
          <span className="rc-badge">{duration} min</span>
          <span className="rc-badge">{transferLabel}</span>
          <span className="rc-badge rc-badge--mode">{fareInfo.journey_type}</span>
        </div>
        <div className="rc-header-right">
          <div className="rc-fare">
            <span className="rc-fare-amount">${fare}</span>
            <span className="rc-fare-label">Adult EZ-Link</span>
          </div>
          <span className={`rc-chevron${expanded ? ' rc-chevron--up' : ''}`}>▾</span>
        </div>
      </div>

      {/* ── Journey summary chip row ─────────────────────────────────────── */}
      <div className="rc-summary">
        <span className="rc-stop-pin rc-stop-pin--a">A</span>
        {legs.map((leg, i) => {
          const mrtColor = (leg.mode === 'SUBWAY' || leg.mode === 'TRAM')
            ? getMrtColor(leg.route) : null;
          const chipStyle = mrtColor
            ? { background: mrtColor, color: '#fff', borderColor: mrtColor }
            : {};
          return (
            <span
              key={i}
              className={`rc-chip rc-chip--${leg.mode.toLowerCase()}`}
              style={chipStyle}
            >
              {chipLabel(leg)}
            </span>
          );
        })}
        <span className="rc-stop-pin rc-stop-pin--b">B</span>
      </div>

      {/* ── Expanded detail ─────────────────────────────────────────────── */}
      {expanded && (
        <div className="rc-detail">
          {legs.map((leg, i) => (
            <LegDetail key={i} leg={leg} />
          ))}
        </div>
      )}
    </div>
  );
}

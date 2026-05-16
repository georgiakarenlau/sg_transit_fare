/**
 * RouteCard — displays one public transport route option.
 *
 * Props:
 *   route       {object}   — one entry from the API `routes` array
 *   index       {number}   — 0-based position in the results list
 *   isSelected  {boolean}  — highlights the card when true
 *   onSelect    {function} — called when the user clicks the card
 */

// ── Mode display helpers ──────────────────────────────────────────────────────

const MODE_NAMES = {
  WALK:   'Walk',
  BUS:    'Bus',
  SUBWAY: 'MRT',
  TRAM:   'LRT',
};

// MRT chip colors — mirrors MRT_LINE_COLORS in App.jsx
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

function getMrtColor(route) {
  const upper = (route ?? '').toUpperCase();
  for (const [key, color] of Object.entries(MRT_CHIP_COLORS)) {
    if (upper.includes(key)) return color;
  }
  return null;
}

/** Strip operator prefix from bus route strings, e.g. "SBST BUS 153" → "153". */
function cleanBusRoute(route) {
  return (route ?? '').replace(/^.*?\bBUS\s+/i, '').trim() || (route ?? '');
}

/** Short label used inside the journey-summary chips. */
function chipLabel(leg) {
  if (leg.mode === 'WALK') return `Walk ${Math.round(leg.duration_minutes)} min`;
  if (leg.mode === 'BUS') {
    const num = cleanBusRoute(leg.route);
    return num ? `Bus ${num}` : 'Bus';
  }
  if (leg.mode === 'SUBWAY' || leg.mode === 'TRAM') return leg.route ?? 'MRT';
  const name = MODE_NAMES[leg.mode] ?? leg.mode;
  return leg.route ? `${name} ${leg.route}` : name;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RouteCard({ route, index, isSelected, onSelect, badge }) {
  const fare     = route.fare.adult_ezlink_sgd.toFixed(2);
  const duration = Math.round(route.duration_minutes);
  const { transfers, legs, fare: fareInfo } = route;

  const transferLabel =
    transfers === 0 ? 'Direct' : `${transfers} transfer${transfers !== 1 ? 's' : ''}`;

  // Only the transit (non-walk) legs are shown in the detail table.
  const transitLegs = legs.filter(l => l.mode !== 'WALK');

  return (
    <div
      className={`route-card${isSelected ? ' selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
      aria-pressed={isSelected}
    >
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="rc-header">
        <div className="rc-meta">
          <span className="rc-option">Option {index + 1}</span>
          {badge && <span className="rc-badge rc-badge--best">{badge}</span>}
          <span className="rc-badge">{duration} min</span>
          <span className="rc-badge">{transferLabel}</span>
          <span className="rc-badge rc-badge--mode">{fareInfo.journey_type}</span>
        </div>
        <div className="rc-fare">
          <span className="rc-fare-amount">${fare}</span>
          <span className="rc-fare-label">Adult EZ-Link</span>
        </div>
      </div>

      {/* ── Journey summary — compact chip row ─────────────────────────── */}
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

      {/* ── Transit leg details ─────────────────────────────────────────── */}
      {transitLegs.length > 0 && (
        <div className="rc-legs">
          {transitLegs.map((leg, i) => (
            <div key={i} className="rc-leg-row">
              <span className={`rc-leg-mode rc-leg-mode--${leg.mode.toLowerCase()}`}>
                {MODE_NAMES[leg.mode] ?? leg.mode}
                {leg.route && (
                  <strong> {leg.mode === 'BUS' ? cleanBusRoute(leg.route) : leg.route}</strong>
                )}
              </span>
              <span className="rc-leg-stops">
                {leg.from_stop}
                <span className="rc-leg-arrow"> → </span>
                {leg.to_stop}
              </span>
              <span className="rc-leg-info">
                {leg.distance_km.toFixed(1)} km · {Math.round(leg.duration_minutes)} min
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

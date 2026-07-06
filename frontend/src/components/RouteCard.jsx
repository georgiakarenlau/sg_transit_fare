import { useState, useEffect } from 'react';
import { getMrtColor, chipLabel, LegDetail } from './LegDetail';

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
      {/* Header */}
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

      {/* Journey summary chip row */}
      <div className="rc-summary">
        <span className="rc-stop-pin rc-stop-pin--a">A</span>
        {legs.map((leg, i) => {
          const mrtColor = (leg.mode === 'SUBWAY' || leg.mode === 'TRAM')
            ? getMrtColor(leg.route) : null;
          const chipStyle = mrtColor
            ? { background: mrtColor, color: '#fff', borderColor: mrtColor }
            : {};
          return (
            <span key={i} className={`rc-chip rc-chip--${leg.mode.toLowerCase()}`} style={chipStyle}>
              {chipLabel(leg)}
            </span>
          );
        })}
        <span className="rc-stop-pin rc-stop-pin--b">B</span>
      </div>

      {/* Level-1 expanded legs */}
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

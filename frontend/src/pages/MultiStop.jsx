import { useState, Fragment } from 'react';
import axios from 'axios';
import LocationInput from '../components/LocationInput';
import { LegDetail, getMrtColor, chipLabel } from '../components/LegDetail';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';

// ── MultiJourneyCard ──────────────────────────────────────────────────────────

function MultiJourneyCard({ journey, index }) {
  const [expanded, setExpanded] = useState(false);

  const fare       = journey.total_fare.fare_sgd.toFixed(2);
  const duration   = Math.round(journey.total_duration_minutes);
  const transfers  = journey.total_transfers;
  const { segments } = journey;
  const hasWarning = segments.slice(0, -1).some(s => s.transfer_warning);

  const transferLabel =
    transfers === 0 ? 'Direct' : `${transfers} transfer${transfers !== 1 ? 's' : ''}`;

  return (
    <div
      className={`route-card${expanded ? ' selected' : ''}`}
      onClick={() => setExpanded(e => !e)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && setExpanded(x => !x)}
      aria-expanded={expanded}
    >
      {/* Header */}
      <div className="rc-header">
        <div className="rc-meta">
          <span className="rc-option">Option {index + 1}</span>
          <span className="rc-badge">{duration} min</span>
          <span className="rc-badge">{transferLabel}</span>
          <span className="rc-badge rc-badge--mode">{journey.total_fare.journey_type}</span>
          {hasWarning && <span className="rc-badge ms-warn-badge">⚠ Check transfer window</span>}
        </div>
        <div className="rc-header-right">
          <div className="rc-fare">
            <span className="rc-fare-amount">${fare}</span>
            <span className="rc-fare-label">Est. total</span>
          </div>
          <span className={`rc-chevron${expanded ? ' rc-chevron--up' : ''}`}>▾</span>
        </div>
      </div>

      {/* Chip summary — [A] chips [B] chips [C] */}
      <div className="rc-summary">
        {segments.map((seg, i) => (
          <Fragment key={i}>
            <span className={`rc-stop-pin ${i === 0 ? 'rc-stop-pin--a' : 'rc-stop-pin--mid'}`}>
              {String.fromCharCode(65 + i)}
            </span>
            {seg.legs.map((leg, j) => {
              const mrtColor = (leg.mode === 'SUBWAY' || leg.mode === 'TRAM')
                ? getMrtColor(leg.route) : null;
              const chipStyle = mrtColor
                ? { background: mrtColor, color: '#fff', borderColor: mrtColor }
                : {};
              return (
                <span key={j} className={`rc-chip rc-chip--${leg.mode.toLowerCase()}`} style={chipStyle}>
                  {chipLabel(leg)}
                </span>
              );
            })}
          </Fragment>
        ))}
        <span className="rc-stop-pin rc-stop-pin--b">
          {String.fromCharCode(65 + segments.length)}
        </span>
      </div>

      {/* Expanded: per-segment breakdown */}
      {expanded && (
        <div className="ms-segments" onClick={e => e.stopPropagation()}>
          {segments.map((seg, i) => (
            <div key={i} className="ms-segment">
              <div className="ms-seg-header">
                <div className="ms-seg-title">
                  <span className="ms-seg-stop-pin">{String.fromCharCode(65 + i)}</span>
                  <span className="ms-seg-stop-name">{seg.from_location}</span>
                  <span className="ms-seg-arrow">→</span>
                  <span className="ms-seg-stop-pin">{String.fromCharCode(66 + i)}</span>
                  <span className="ms-seg-stop-name">{seg.to_location}</span>
                </div>
                <div className="ms-seg-meta-right">
                  <span className="ms-seg-duration">{Math.round(seg.duration_minutes)} min</span>
                  {seg.transfer_warning && i < segments.length - 1 && (
                    <span
                      className="ms-warn-text"
                      title="This leg takes over 40 min — you may have under 5 min to board the next service within the 45-min tap window"
                    >
                      ⚠ Tight 45-min window
                    </span>
                  )}
                </div>
              </div>
              <div className="rc-detail">
                {seg.legs.map((leg, j) => (
                  <LegDetail key={j} leg={leg} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const OPTIMIZE_OPTIONS = [
  { key: 'fare',      label: 'Lowest Fare'     },
  { key: 'transfers', label: 'Fewest Transfers' },
  { key: 'walk',      label: 'Least Walking'    },
];

// ── MultiStop page ────────────────────────────────────────────────────────────

export default function MultiStop() {
  const [stops, setStops]       = useState(['', '']);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [result, setResult]     = useState(null);
  const [optimizeBy, setOptimizeBy] = useState('fare');

  const canPlan = stops.every(s => s.trim().length >= 2) && !loading;

  function updateStop(i, val) {
    setStops(prev => prev.map((s, idx) => idx === i ? val : s));
  }

  function addStop() {
    if (stops.length < 5) setStops(prev => [...prev, '']);
  }

  function removeStop(i) {
    if (stops.length <= 2) return;
    setStops(prev => prev.filter((_, idx) => idx !== i));
  }

  function moveStop(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    setStops(prev => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function handlePlan(e) {
    e.preventDefault();
    const trimmed = stops.map(s => s.trim()).filter(Boolean);
    if (trimmed.length < 2) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data } = await axios.post(`${API_BASE}/api/multi-route`, { stops: trimmed });
      setResult(data);
      setOptimizeBy('fare');
    } catch (err) {
      if (err.response) {
        setError(err.response.data?.detail ?? 'Failed to plan journey.');
      } else {
        setError('Cannot connect to the backend. Make sure it is running.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="search-panel">
        <h2 className="ms-page-title">Multi-Stop Planner</h2>
        <p className="ms-page-desc">
          Plan a trip with up to 5 stops. Fares are calculated as a single SimplyGo transfer journey across all legs.
        </p>

        <form onSubmit={handlePlan}>
          <div className="ms-stop-inputs">
            {stops.map((stop, i) => (
              <div key={i} className="ms-stop-row">
                <div className="ms-move-btns">
                  <button
                    type="button"
                    className="ms-move-btn"
                    onClick={() => moveStop(i, -1)}
                    disabled={i === 0}
                    aria-label="Move stop up"
                  >▲</button>
                  <button
                    type="button"
                    className="ms-move-btn"
                    onClick={() => moveStop(i, 1)}
                    disabled={i === stops.length - 1}
                    aria-label="Move stop down"
                  >▼</button>
                </div>
                <LocationInput
                  id={`ms-stop-${i}`}
                  label={i === 0 ? 'From' : i === stops.length - 1 ? 'To' : 'Via'}
                  placeholder={
                    i === 0                  ? 'e.g. Orchard MRT'
                    : i === stops.length - 1 ? 'e.g. Changi Airport'
                    : 'e.g. Commonwealth MRT'
                  }
                  value={stop}
                  onChange={v => updateStop(i, v)}
                />
                {stops.length > 2 && (
                  <button
                    type="button"
                    className="ms-remove-btn"
                    onClick={() => removeStop(i)}
                    aria-label="Remove this stop"
                  >×</button>
                )}
              </div>
            ))}
          </div>

          <div className="ms-form-actions">
            {stops.length < 5
              ? <button type="button" className="ms-add-btn" onClick={addStop}>+ Add stop</button>
              : <span />
            }
            <button type="submit" className="search-btn" disabled={!canPlan}>
              {loading ? 'Planning…' : 'Plan Journey'}
            </button>
          </div>
        </form>
      </section>

      {loading && (
        <div className="status status--loading">
          <span className="spinner" aria-hidden="true" />
          Planning your multi-stop journey…
        </div>
      )}

      {error && !loading && (
        <div className="status status--error" role="alert">{error}</div>
      )}

      {result && !loading && (() => {
        const sorted = [...result.journeys].sort((a, b) => {
          if (optimizeBy === 'fare')
            return a.total_fare.fare_cents - b.total_fare.fare_cents
                || a.total_duration_minutes - b.total_duration_minutes;
          if (optimizeBy === 'transfers')
            return a.total_transfers - b.total_transfers
                || a.total_duration_minutes - b.total_duration_minutes;
          // walk
          return a.walk_distance_km - b.walk_distance_km
              || a.total_duration_minutes - b.total_duration_minutes;
        });

        return (
          <section className="routes-section">
            <div className="routes-heading-row">
              <h2 className="routes-heading">
                {result.journeys.length} option{result.journeys.length !== 1 ? 's' : ''} found
                <span className="routes-subtitle">{result.stops.join(' → ')}</span>
              </h2>
              <div className="optimize-selector">
                <span className="optimize-label">Optimise by</span>
                {OPTIMIZE_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`opt-btn${optimizeBy === opt.key ? ' active' : ''}`}
                    onClick={() => setOptimizeBy(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ms-transfer-note">
              Fares shown are the <strong>sum of individual segment fares</strong> — each leg is priced separately
              since you plan to stop at via points. Prices are indicative adult EZ-Link fares.
            </div>

            <div className="route-list">
              {sorted.map((journey, i) => (
                <MultiJourneyCard key={i} journey={journey} index={i} />
              ))}
            </div>
          </section>
        );
      })()}
    </>
  );
}

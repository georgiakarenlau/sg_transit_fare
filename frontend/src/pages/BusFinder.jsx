/**
 * BusFinder — find buses running between two stops with live arrival times.
 *
 * Users search for stops by name, road, or code via autocomplete backed by
 * /api/bus-stops/search.  On submit, /api/bus-between returns matching
 * services and their next three arrivals at Stop A.
 */

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEBOUNCE_MS = 300;

// ── BusStopInput ──────────────────────────────────────────────────────────────
// Autocomplete input for bus stops. Calls /api/bus-stops/search and lets the
// user pick a stop; the selected stop object is passed to onSelect().

function BusStopInput({ id, label, placeholder, onSelect }) {
  const [query,       setQuery]       = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop,    setShowDrop]    = useState(false);
  const [active,      setActive]      = useState(-1);

  const debounceRef = useRef(null);
  const abortRef    = useRef(null);
  const skipRef     = useRef(false);   // suppress search after programmatic set

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (skipRef.current) { skipRef.current = false; return; }
    if (query.trim().length < 2) {
      abortRef.current?.abort();
      setSuggestions([]);
      setShowDrop(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const { data } = await axios.get(`${API_BASE}/api/bus-stops/search`, {
          params: { q: query.trim() },
          signal: abortRef.current.signal,
        });
        setSuggestions(data);
        setShowDrop(data.length > 0);
        setActive(-1);
      } catch (err) {
        if (err.code === 'ERR_CANCELED') return;
        setSuggestions([]);
        setShowDrop(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function select(stop) {
    abortRef.current?.abort();
    skipRef.current = true;
    setQuery(`${stop.code} — ${stop.name}`);
    setShowDrop(false);
    setSuggestions([]);
    setActive(-1);
    onSelect(stop);
  }

  function onKeyDown(e) {
    if (!showDrop) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(suggestions[active]);
    } else if (e.key === 'Escape') {
      setShowDrop(false);
    }
  }

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="autocomplete-wrapper">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={e => { setQuery(e.target.value); onSelect(null); }}
          onFocus={() => suggestions.length > 0 && setShowDrop(true)}
          onBlur={() => setShowDrop(false)}
          onKeyDown={onKeyDown}
        />
        {showDrop && (
          <ul className="suggestion-list" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={i}
                role="option"
                aria-selected={i === active}
                className={`suggestion-item${i === active ? ' active' : ''}`}
                onMouseDown={() => select(s)}
              >
                <span className="suggestion-name">{s.code} — {s.name}</span>
                <span className="suggestion-address">{s.road}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── ArrivalChip ───────────────────────────────────────────────────────────────
// Colour-coded arrival time badge.
//   green  → arriving now or ≤ 3 min
//   amber  → 4 – 9 min
//   grey   → 10+ min or no data

function ArrivalChip({ minutes }) {
  if (minutes === null || minutes === undefined)
    return <span className="arrival-chip arrival-chip--none">—</span>;
  if (minutes <= 0)
    return <span className="arrival-chip arrival-chip--now">Arr</span>;
  const cls = minutes <= 3 ? 'arrival-chip--soon'
            : minutes <= 9 ? 'arrival-chip--mid'
                           : 'arrival-chip--later';
  return <span className={`arrival-chip ${cls}`}>{minutes} min</span>;
}

// ── BusFinder page ────────────────────────────────────────────────────────────

export default function BusFinder() {
  const [fromStop, setFromStop] = useState(null);
  const [toStop,   setToStop]   = useState(null);
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleFind(e) {
    e.preventDefault();
    if (!fromStop || !toStop) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const { data } = await axios.get(`${API_BASE}/api/bus-between`, {
        params: { from_stop: fromStop.code, to_stop: toStop.code },
      });
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Failed to fetch bus arrivals.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-main">

      {/* ── Search panel ───────────────────────────────────────────────── */}
      <section className="search-panel">
        <form className="search-form" onSubmit={handleFind}>
          <div className="search-row">

            <BusStopInput
              id="bf-from"
              label="Board at (Stop A)"
              placeholder="e.g. BLK 97 or 09048"
              onSelect={setFromStop}
            />

            <BusStopInput
              id="bf-to"
              label="Alight at (Stop B)"
              placeholder="e.g. Farrer Road MRT"
              onSelect={setToStop}
            />

            <button
              type="submit"
              className="search-btn"
              disabled={loading || !fromStop || !toStop}
            >
              {loading ? 'Searching…' : 'Find Buses'}
            </button>

          </div>
        </form>
      </section>

      {/* ── Results ────────────────────────────────────────────────────── */}
      <section className="routes-section">

        {loading && (
          <div className="status status--loading">
            <span className="spinner" aria-hidden="true" />
            Checking arrivals…
          </div>
        )}

        {error && !loading && (
          <div className="status status--error" role="alert">{error}</div>
        )}

        {!results && !loading && !error && (
          <div className="status status--hint">
            Enter a boarding stop and an alighting stop, then click{' '}
            <strong>Find Buses</strong>.
          </div>
        )}

        {results && !loading && (
          results.buses.length === 0 ? (
            <div className="status status--hint">
              No direct buses found between{' '}
              <strong>{fromStop.code}</strong> and <strong>{toStop.code}</strong>{' '}
              in this direction.
            </div>
          ) : (
            <div className="bf-results">
              <div className="bf-heading">
                <h2 className="bf-title">
                  Buses from <span className="bf-code">{fromStop.code}</span> to{' '}
                  <span className="bf-code">{toStop.code}</span>
                </h2>
                <p className="bf-subtitle">
                  {fromStop.name} ({fromStop.road})
                  {' → '}
                  {toStop.name} ({toStop.road})
                </p>
              </div>

              <table className="bf-table">
                <thead>
                  <tr>
                    <th>Bus</th>
                    <th>Next</th>
                    <th>2nd</th>
                    <th>3rd</th>
                  </tr>
                </thead>
                <tbody>
                  {results.buses.map(b => (
                    <tr key={b.bus_number}>
                      <td className="bf-bus-no">{b.bus_number}</td>
                      {b.arrivals.map((mins, i) => (
                        <td key={i}><ArrivalChip minutes={mins} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="bf-disclaimer">
                Live arrivals from LTA DataMall · refreshed on each search
              </p>
            </div>
          )
        )}

      </section>
    </main>
  );
}

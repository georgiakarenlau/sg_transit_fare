import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const DEBOUNCE_MS = 250;

export default function LocationInput({ id, label, placeholder, value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeSuggestion, setActive] = useState(-1);

  const wrapperRef  = useRef(null);
  const debounceRef = useRef(null);
  const abortRef    = useRef(null);   // AbortController for the in-flight request
  const skipRef     = useRef(false);  // true for one render after a selection

  // ── Fetch suggestions ─────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);

    // Suppress the search triggered by programmatically setting the value
    // after the user selects a suggestion.
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }

    if (value.trim().length < 2) {
      abortRef.current?.abort();
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      // Cancel any previous in-flight request so stale responses never
      // overwrite newer results.
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const { data } = await axios.get(`${API_BASE}/api/search`, {
          params: { q: value.trim() },
          signal: abortRef.current.signal,
        });
        setSuggestions(data);
        setShowDropdown(data.length > 0);
        setActive(-1);
      } catch (err) {
        if (err.code === 'ERR_CANCELED') return; // aborted — ignore silently
        setSuggestions([]);
        setShowDropdown(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [value]);

  // ── Close when focus leaves this component ────────────────────────────────
  // onBlur fires AFTER onMouseDown, so a suggestion click is already handled
  // by select() before this runs — closing here is always safe.
  function onBlur() {
    setShowDropdown(false);
  }

  // ── Select a suggestion ───────────────────────────────────────────────────
  function select(suggestion) {
    abortRef.current?.abort();  // cancel any pending request
    skipRef.current = true;     // skip the useEffect triggered by onChange below
    onChange(suggestion.name);
    setShowDropdown(false);
    setSuggestions([]);
    setActive(-1);
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!showDropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeSuggestion >= 0) {
      e.preventDefault();
      select(suggestions[activeSuggestion]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="input-group" ref={wrapperRef}>
      <label htmlFor={id}>{label}</label>

      <div className="autocomplete-wrapper">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={e => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />

        {showDropdown && (
          <ul className="suggestion-list" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={i}
                role="option"
                aria-selected={i === activeSuggestion}
                className={`suggestion-item${i === activeSuggestion ? ' active' : ''}`}
                onMouseDown={() => select(s)}
              >
                <span className="suggestion-name">{s.name}</span>
                {s.address && (
                  <span className="suggestion-address">{s.address}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

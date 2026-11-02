import { useEffect, useRef, useState } from 'react';

function ClearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * A picker button with a popover of checkboxes. `items` are { key, name, count?, group?, depth? }; items
 * sharing a `group` follow its heading (keep them together); `depth` indents an item (a tree), unless searching. The button shows `summary`, or the
 * selected names, or `emptyLabel` when nothing is selected; the clear button shows with `onClear`.
 * With `onSetAll(checked)` the list starts with an «all» checkbox. The search matches names and groups.
 */
export default function CheckPicker({
  label, items, selected, onToggle, onClear, onSetAll, summary, emptyLabel = 'Все', clearLabel,
  searchPlaceholder = 'Поиск', notFound = 'Ничего не найдено', className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = selected.length > 0;
  const allChecked = items.every((i) => selected.includes(i.key));
  const nameOf = (key) => items.find((i) => i.key === key)?.name ?? key;
  const query = search.trim().replace(/^#+/, '').toLowerCase();
  const found = query
    ? items.filter((i) => [i.name, i.group ?? ''].some((text) => text.toLowerCase().includes(query)))
    : items;

  function toggleOpen() {
    setSearch('');
    setOpen(!open);
  }

  return (
    <div className={`picker check-picker ${className}`} ref={root}>
      <button type="button" className={`select ${onClear ? '' : 'select-empty'}`} aria-expanded={open}
        onClick={toggleOpen}>
        <span className="picker-label">{label}</span>
        <span className="picker-value">{summary ?? (active ? selected.map(nameOf).join(', ') : emptyLabel)}</span>
      </button>
      {onClear && (
        <button className="btn-clear" title={clearLabel} aria-label={clearLabel} onClick={onClear}>
          <ClearIcon />
        </button>
      )}
      {open && (
        <div className="check-menu">
          <input className="check-search" type="search" placeholder={searchPlaceholder} autoFocus
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !found.length) return;
              e.preventDefault();
              onToggle(found[0].key);
              setSearch('');
            }} />
          {onSetAll && !query && items.length > 1 && (
            <label className="check-menu-item check-menu-all">
              <input type="checkbox" checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = active && !allChecked; }}
                onChange={() => onSetAll(!allChecked)} />
              <span className="check-menu-name">Все</span>
            </label>
          )}
          {found.length === 0 && <p className="check-menu-empty">{notFound}</p>}
          {found.map((item, i) => (
            <div key={item.key}>
              {item.group && item.group !== found[i - 1]?.group && (
                <div className="check-menu-group">{item.group}</div>
              )}
              <label className="check-menu-item" style={item.depth && !query ? { paddingLeft: `${0.5 + item.depth * 1.1}rem` } : undefined}>
                <input type="checkbox" checked={selected.includes(item.key)} onChange={() => onToggle(item.key)} />
                <span className="check-menu-name">{item.name}</span>
                {item.count != null && <span className="count">{item.count}</span>}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

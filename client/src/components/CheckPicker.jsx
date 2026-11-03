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
 * `indeterminate` lists keys shown half-checked; with `onOnly(key)` each item has a «только» button.
 * In a tree (`depth`), items with nested ones fold; with `collapseKey` what is folded is remembered.
 */
export default function CheckPicker({
  label, items, selected, onToggle, onClear, onSetAll, summary, emptyLabel = 'Все', clearLabel,
  searchPlaceholder = 'Поиск', notFound = 'Ничего не найдено', className = '', indeterminate = [], onOnly,
  collapseKey,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return new Set(collapseKey ? JSON.parse(localStorage.getItem(collapseKey) ?? '[]') : []);
    } catch {
      return new Set();
    }
  });
  const root = useRef(null);

  function saveCollapsed(next) {
    setCollapsed(next);
    if (collapseKey) localStorage.setItem(collapseKey, JSON.stringify([...next]));
  }

  function toggleCollapsed(key) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveCollapsed(next);
  }

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
  const tree = items.some((i) => i.depth);
  const hasNested = (i) => (items[i + 1]?.depth ?? 0) > (items[i].depth ?? 0);
  // Items under a folded one are left out (deeper than it, up to the next at its depth or above).
  const unfolded = [];
  let foldedAt = null;
  items.forEach((item, i) => {
    const depth = item.depth ?? 0;
    if (foldedAt !== null && depth > foldedAt) return;
    foldedAt = null;
    unfolded.push({ ...item, nested: hasNested(i) });
    if (hasNested(i) && collapsed.has(item.key)) foldedAt = depth;
  });
  const foldable = items.filter((_, i) => hasNested(i)).map((i) => i.key);
  const found = query
    ? items.filter((i) => [i.name, i.group ?? ''].some((text) => text.toLowerCase().includes(query)))
    : unfolded;

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
          <input className="check-search" type="search" placeholder={searchPlaceholder}
            value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !found.length) return;
              e.preventDefault();
              onToggle(found[0].key);
              setSearch('');
            }} />
          {tree && !query && foldable.length > 0 && (
            <div className="check-menu-folds">
              <button type="button" className="check-menu-fold-all" disabled={!foldable.some((k) => collapsed.has(k))}
                onClick={() => saveCollapsed(new Set())}>Развернуть все</button>
              <button type="button" className="check-menu-fold-all" disabled={foldable.every((k) => collapsed.has(k))}
                onClick={() => saveCollapsed(new Set(foldable))}>Свернуть все</button>
            </div>
          )}
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
                {tree && !query && (item.nested ? (
                  <button type="button" className="check-menu-fold" aria-expanded={!collapsed.has(item.key)}
                    aria-label={collapsed.has(item.key) ? 'Развернуть' : 'Свернуть'}
                    onClick={(e) => { e.preventDefault(); toggleCollapsed(item.key); }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                ) : <span className="check-menu-fold-space" aria-hidden="true" />)}
                <input type="checkbox" checked={selected.includes(item.key)} onChange={() => onToggle(item.key)}
                  ref={(el) => { if (el) el.indeterminate = indeterminate.includes(item.key); }} />
                <span className="check-menu-name">{item.name}</span>
                {item.count != null && <span className="count">{item.count}</span>}
                {onOnly && (
                  <button type="button" className="check-menu-only" title="Показать только эту"
                    onClick={(e) => { e.preventDefault(); onOnly(item.key); }}>
                    только
                  </button>
                )}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

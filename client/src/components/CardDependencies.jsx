import { useMemo, useState } from 'react';
import { updateCard } from '../actions.js';
import { withoutLinks } from '../links.js';
import {
  canAddDependency, dependsOnOf, dependencyTitle, pendingDependencies,
} from '../dependencies.js';

function matchCard(card, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const title = withoutLinks(card.title).toLowerCase();
  const num = card.number ? `#${card.number}` : '';
  return title.includes(q) || num.includes(q);
}

/**
 * Cards this task waits on. Saves via `updateCard` like the checklist.
 */
export default function CardDependencies({ card, cards, readOnly, onOpen }) {
  const [open, setOpen] = useState(() => dependsOnOf(card).length > 0);
  const [query, setQuery] = useState('');
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const ids = dependsOnOf(card);
  const pending = pendingDependencies(card, cardById);

  if (readOnly && !ids.length) return null;

  const add = (depId) => {
    if (!canAddDependency(card.id, depId, cardById)) return;
    updateCard(card.id, { dependsOn: [...ids, depId] });
    setQuery('');
  };
  const remove = (depId) => updateCard(card.id, { dependsOn: ids.filter((id) => id !== depId) });

  const choices = cards
    .filter((c) => c.id !== card.id && !c.deleted && !c.purged && !ids.includes(c.id))
    .filter((c) => matchCard(c, query))
    .filter((c) => canAddDependency(card.id, c.id, cardById))
    .slice(0, 12);

  return (
    <section className="dependencies" aria-label="Зависимости">
      <div className="attachments-head">
        <h3 className="attachments-title">Зависимости</h3>
        {!readOnly && ids.length > 0 && (
          <button type="button" className="btn btn-small" onClick={() => setOpen((v) => !v)}>
            {open ? 'Свернуть' : 'Развернуть'}
          </button>
        )}
      </div>
      {open && (
        <>
          {ids.length > 0 ? (
            <ul className="dependency-list">
              {ids.map((id) => {
                const dep = cardById.get(id);
                const waiting = pending.includes(id);
                return (
                  <li key={id} className={waiting ? 'dependency-item-wait' : 'dependency-item-done'}>
                    <button type="button" className="dependency-link" onClick={() => onOpen?.(id)}>
                      {dep?.number != null && <span className="dependency-num">#{dep.number} </span>}
                      {dependencyTitle(dep)}
                    </button>
                    {waiting
                      ? <span className="dependency-state">ожидает</span>
                      : <span className="dependency-state dependency-state-ok">готово</span>}
                    {!readOnly && (
                      <button type="button" className="btn btn-small dependency-remove" aria-label="Убрать зависимость"
                        onClick={() => remove(id)}>×</button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted dependency-empty">Пока нет — задача не ждёт другие карточки.</p>
          )}
          {pending.length > 0 && (
            <p className="notice dependency-hint">
              Пока не выполнены зависимости, задачу нельзя перенести из первой колонки, в последнюю или отметить выполненной.
            </p>
          )}
          {!readOnly && (
            <div className="dependency-add">
              <input type="search" className="dependency-search" placeholder="Найти карточку…"
                aria-label="Найти карточку для зависимости" value={query} onChange={(e) => setQuery(e.target.value)} />
              {query.trim() && choices.length > 0 && (
                <ul className="dependency-pick">
                  {choices.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="dependency-pick-btn" onClick={() => add(c.id)}>
                        {c.number != null && <span className="dependency-num">#{c.number} </span>}
                        {dependencyTitle(c)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && choices.length === 0 && (
                <p className="muted dependency-no-match">Ничего не найдено</p>
              )}
            </div>
          )}
        </>
      )}
      {!open && pending.length > 0 && (
        <p className="muted dependency-collapsed">Ждёт {pending.length} {pending.length === 1 ? 'задачу' : 'задачи'}</p>
      )}
    </section>
  );
}

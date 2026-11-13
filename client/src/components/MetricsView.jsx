import { useMemo } from 'react';
import { computeMetrics } from '../metrics.js';
import { plural } from './ManageFields.jsx';
import { personLabel, personOf, useBoardPeople } from './CardPeople.jsx';

function Tile({ label, value, hint, tone }) {
  return (
    <div className={`metrics-tile${tone ? ` metrics-tile-${tone}` : ''}`}>
      <span className="metrics-tile-value">{value}</span>
      <span className="metrics-tile-label">{label}</span>
      {hint && <span className="metrics-tile-hint">{hint}</span>}
    </div>
  );
}

function BarList({ items, labelOf, max: maxProp }) {
  if (!items.length) return <p className="muted metrics-empty">Нет данных</p>;
  const max = maxProp ?? Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="metrics-bars">
      {items.map((item) => (
        <li key={item.id} className="metrics-bar-row">
          <span className="metrics-bar-label" title={labelOf(item)}>{labelOf(item)}</span>
          <div className="metrics-bar-track" aria-hidden="true">
            <div className="metrics-bar-fill" style={{ width: `${(item.count / max) * 100}%` }} />
          </div>
          <span className="metrics-bar-count">
            {item.count}
            {item.done > 0 && <span className="metrics-bar-done-n"> · {item.done} гот.</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Key metrics for the cards in view (same filters as the board and the list). `columnsOfFolder` names columns;
 * `folderName` labels boards.
 */
export default function MetricsView({ cards, columnsOfFolder, folderName }) {
  const { people, meId } = useBoardPeople();
  const metrics = useMemo(
    () => computeMetrics(cards, { columnsOfFolder, folderName }),
    [cards, columnsOfFolder, folderName],
  );
  const holderLabel = (item) => (item.id === '_none'
    ? 'Без исполнителя'
  : personLabel(personOf(people, item.id), meId));

  return (
    <main className="metrics-view">
      <p className="list-count">
        {metrics.total} {plural(metrics.total, 'карточка', 'карточки', 'карточек')} по фильтрам
      </p>

      <div className="metrics-tiles">
        <Tile label="В работе" value={metrics.inWork} hint={metrics.total ? `${metrics.donePct}% выполнено` : undefined} />
        <Tile label="Выполнено" value={metrics.done} />
        <Tile label="Просрочен дедлайн" value={metrics.overdue} tone={metrics.overdue ? 'danger' : undefined} />
        <Tile label="Дедлайн сегодня" value={metrics.dueToday} tone={metrics.dueToday ? 'warn' : undefined} />
        <Tile label="Дедлайн на 7 дней" value={metrics.dueWeek} hint={`${metrics.withDeadline} с дедлайном`} />
        <Tile label="Напоминания" value={metrics.withReminder} hint={metrics.reminderSoon ? `${metrics.reminderSoon} на неделе` : undefined} />
        <Tile label="Без исполнителя" value={metrics.noAssignee} />
        {metrics.conflicts > 0 && <Tile label="Конфликты синхр." value={metrics.conflicts} tone="danger" />}
        {metrics.checklistPct != null && (
          <Tile label="Подзадачи" value={`${metrics.checklistPct}%`}
            hint={`${metrics.checklistDone}/${metrics.checklistItems} в ${metrics.cardsWithChecklist} ${
              plural(metrics.cardsWithChecklist, 'карточке', 'карточках', 'карточках')}`} />
        )}
      </div>

      <section className="metrics-section">
        <h2 className="metrics-heading">По колонкам</h2>
        <BarList items={metrics.columns} labelOf={(c) => c.name} />
      </section>

      {metrics.folders.length > 1 && (
        <section className="metrics-section">
          <h2 className="metrics-heading">По доскам</h2>
          <BarList items={metrics.folders} labelOf={(f) => f.name} />
        </section>
      )}

      <section className="metrics-section">
        <h2 className="metrics-heading">По исполнителям</h2>
        <BarList items={metrics.holders} labelOf={holderLabel} max={metrics.holders[0]?.count} />
      </section>
    </main>
  );
}

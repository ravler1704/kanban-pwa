import { useEffect, useMemo, useRef, useState } from 'react';
import { updateCard } from '../actions.js';
import { cardColor, columnColor } from '../appearance.js';
import { flattenFolders } from '../folders.js';
import { withoutLinks } from '../links.js';
import { cardReminders, timesBetween } from '../reminders.js';

const SCALE_KEY = 'ganttScale';
const SIDE = 168;
const DAY = 86_400_000;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function mondayOf(d) {
  const day = startOfDay(d);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function shiftTime(at, days) {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function ChevronIcon({ left }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

/** Days of the visible range: weeks covering the month, or twelve weeks from the month's Monday. */
function rangeDays(month, scale) {
  const monday = mondayOf(month);
  if (scale === 'week') {
    return Array.from({ length: 84 }, (_, i) => addDays(monday, i));
  }
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = addDays(mondayOf(addDays(last, 1)), -1);
  const days = [];
  for (let d = new Date(monday); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * How the card sits on the timeline in [from, to): one-off reminders become a bar from the first
 * to the last, repeating ones a one-day bar at each time they fire.
 */
function barsOf(card, from, to) {
  const oneOff = [];
  const repeats = [];
  for (const reminder of cardReminders(card)) {
    if (reminder.repeat) repeats.push(...timesBetween(reminder, from, to));
    else if (reminder.at >= from && reminder.at < to) oneOff.push(reminder.at);
  }
  const bars = repeats.map((at) => ({ at, start: startOfDay(new Date(at)), days: 1 }));
  if (oneOff.length) {
    const first = startOfDay(new Date(Math.min(...oneOff)));
    const last = startOfDay(new Date(Math.max(...oneOff)));
    bars.push({ at: Math.min(...oneOff), start: first, days: Math.round((last - first) / DAY) + 1 });
  }
  return bars.sort((a, b) => a.start - b.start);
}

function formatBar(start, days) {
  const end = addDays(start, days - 1);
  const opt = { day: 'numeric', month: 'short' };
  if (days === 1) return start.toLocaleDateString('ru-RU', { ...opt, weekday: 'short' });
  return `${start.toLocaleDateString('ru-RU', opt)} – ${end.toLocaleDateString('ru-RU', opt)}`;
}

/**
 * Cards with a reminder, as bars on a day/week scale. `cards` are those of the folders in view.
 * Dragging a bar moves its reminders by whole days; a click still opens the card.
 */
export default function GanttView({ cards, folders, columns, cardLabel, readOnly, onOpen }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [scale, setScale] = useState(() => (localStorage.getItem(SCALE_KEY) === 'week' ? 'week' : 'day'));
  const [drag, setDrag] = useState(null);
  const scroller = useRef(null);
  const todayLeft = useRef(null);
  const dragSession = useRef(null);

  const dayW = scale === 'week' ? 12 : 36;
  const days = useMemo(() => rangeDays(month, scale), [month, scale]);
  const from = days[0].getTime();
  const to = addDays(days.at(-1), 1).getTime();
  const today = startOfDay(new Date());
  const todayIndex = days.findIndex((d) => dayKey(d) === dayKey(today));
  const columnById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  const groups = useMemo(() => {
    const byFolder = new Map();
    for (const card of cards) {
      if (card.deleted) continue;
      const bars = barsOf(card, from, to);
      if (!bars.length) continue;
      if (!byFolder.has(card.folderId)) byFolder.set(card.folderId, []);
      byFolder.get(card.folderId).push({ card, bars });
    }
    const rowOrder = (a, b) => a.card.position - b.card.position
      || (a.card.number ?? 0) - (b.card.number ?? 0)
      || a.card.id.localeCompare(b.card.id);
    for (const list of byFolder.values()) list.sort(rowOrder);
    const rows = [];
    for (const { folder } of flattenFolders(folders)) {
      const list = byFolder.get(folder.id);
      if (!list) continue;
      rows.push({ type: 'group', id: folder.id, name: folder.name });
      for (const item of list) rows.push({ type: 'card', ...item });
      byFolder.delete(folder.id);
    }
    const rest = [...byFolder.values()].flat().sort(rowOrder);
    if (rest.length) {
      rows.push({ type: 'group', id: '_', name: 'Другие' });
      for (const item of rest) rows.push({ type: 'card', ...item });
    }
    return rows;
  }, [cards, folders, from, to]);

  const changeScale = (next) => {
    setScale(next);
    localStorage.setItem(SCALE_KEY, next);
  };
  const shift = (n) => {
    if (scale === 'week') setMonth(addDays(month, n * 28));
    else setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  };
  const goToday = () => {
    const d = new Date();
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  };

  useEffect(() => {
    todayLeft.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [month, scale]);

  useEffect(() => () => dragSession.current?.end(), []);

  const title = scale === 'week'
    ? `${days[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${
      days.at(-1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${capitalize(month.toLocaleDateString('ru-RU', { month: 'long' }))} ${month.getFullYear()}`;

  const indexOf = (date) => Math.round((startOfDay(date) - days[0]) / DAY);

  const onBarPointer = (event, card) => {
    if (readOnly || event.button) return;
    event.preventDefault();
    if (dragSession.current) return;
    const bar = event.currentTarget;
    const pointerId = event.pointerId;
    bar.setPointerCapture(pointerId);
    const originX = event.clientX;
    const originY = event.clientY;
    const detach = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      try { bar.releasePointerCapture(pointerId); } catch { /* element may be gone */ }
      dragSession.current = null;
      setDrag(null);
    };
    const move = (ev) => {
      if (ev.pointerId !== pointerId) return;
      setDrag({ id: card.id, days: Math.round((ev.clientX - originX) / dayW) });
    };
    const up = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const daysMoved = Math.round((ev.clientX - originX) / dayW);
      detach();
      if (Math.abs(ev.clientX - originX) < 6 && Math.abs(ev.clientY - originY) < 6) {
        onOpen(card.id);
        return;
      }
      if (!daysMoved) return;
      const reminders = cardReminders(card).map((r) => ({ ...r, at: shiftTime(r.at, daysMoved) }));
      updateCard(card.id, { reminders, remindAt: null });
    };
    dragSession.current = { end: detach };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };

  const cardRows = groups.filter((r) => r.type === 'card').length;
  const groupCount = groups.filter((r) => r.type === 'group').length;
  const innerWidth = SIDE + days.length * dayW;

  return (
    <main className="gantt">
      <div className="cal-header">
        <button className="btn btn-small btn-icon-only" aria-label="Назад" onClick={() => shift(-1)}>
          <ChevronIcon left />
        </button>
        <h2 className="cal-title">{title}</h2>
        <button className="btn btn-small btn-icon-only" aria-label="Вперёд" onClick={() => shift(1)}>
          <ChevronIcon />
        </button>
        <button className="btn btn-small" onClick={goToday}>Сегодня</button>
        <div className="gantt-scales" role="radiogroup" aria-label="Масштаб">
          {[['day', 'Дни'], ['week', 'Недели']].map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={scale === id}
              className={`btn btn-small${scale === id ? ' btn-primary' : ''}`}
              onClick={() => changeScale(id)}>{name}</button>
          ))}
        </div>
      </div>

      {cardRows === 0 ? (
        <p className="list-empty">Нет карточек с напоминаниями на эти даты. Добавьте напоминание — карточка появится на диаграмме.</p>
      ) : (
        <div className="gantt-scroll" ref={scroller}>
          <div className="gantt-inner" style={{ '--gantt-side': `${SIDE}px`, '--gantt-day': `${dayW}px`, '--gantt-days': days.length, width: innerWidth }}>
            <div className="gantt-head">
              <div className="gantt-label gantt-corner">Карточка</div>
              <div className="gantt-scale">
                {days.map((d, i) => {
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = dayKey(d) === dayKey(today);
                  const show = scale === 'day' || d.getDay() === 1;
                  return (
                    <div key={dayKey(d)} ref={isToday ? todayLeft : undefined}
                      className={`gantt-day${weekend ? ' gantt-weekend' : ''}${isToday ? ' gantt-today-col' : ''}`}
                      title={d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}>
                      {show && (
                        <>
                          <span className="gantt-day-num">{d.getDate()}</span>
                          {scale === 'day' && <span className="gantt-day-w">{WEEKDAYS[(d.getDay() + 6) % 7]}</span>}
                          {scale === 'week' && i % 7 === 0 && (
                            <span className="gantt-day-w">{d.toLocaleDateString('ru-RU', { month: 'short' })}</span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {groups.map((row) => (row.type === 'group' ? (groupCount < 2 ? null : (
              <div key={`g-${row.id}`} className="gantt-group">
                <div className="gantt-label">{row.name}</div>
                <div className="gantt-track" aria-hidden="true">
                  {days.map((d) => (
                    <div key={dayKey(d)} className={`gantt-cell${d.getDay() === 0 || d.getDay() === 6 ? ' gantt-weekend' : ''}`} />
                  ))}
                </div>
              </div>
            )) : (
              <GanttRow key={row.card.id} item={row} days={days} dayW={dayW} todayIndex={todayIndex}
                column={columnById.get(row.card.columnId)} cardLabel={cardLabel} drag={drag}
                indexOf={indexOf} past={row.bars.every((b) => addDays(b.start, b.days) <= today)}
                onOpen={onOpen} onBarPointer={onBarPointer} />
            )))}

            {todayIndex >= 0 && (
              <div className="gantt-now" style={{ left: SIDE + todayIndex * dayW }} aria-hidden="true" />
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function GanttRow({ item, days, dayW, todayIndex, column, cardLabel, drag, indexOf, past, onOpen, onBarPointer }) {
  const { card, bars } = item;
  const shiftDays = drag?.id === card.id ? drag.days : 0;
  const title = withoutLinks(card.title) || 'Без названия';
  const color = cardColor(card) || (column ? columnColor(column) : null) || 'var(--accent)';

  return (
    <div className={`gantt-row${card.done ? ' gantt-done' : ''}${past ? ' gantt-past' : ''}`}>
      <button type="button" className="gantt-label gantt-open" title={title} onClick={() => onOpen(card.id)}>
        {card.number != null && <span className="gantt-num">#{card.number}</span>}
        <span className="gantt-title">{title}</span>
        {cardLabel?.(card) && <span className="gantt-meta">{cardLabel(card)}</span>}
      </button>
      <div className="gantt-track">
        {days.map((d, i) => (
          <div key={dayKey(d)} className={`gantt-cell${d.getDay() === 0 || d.getDay() === 6 ? ' gantt-weekend' : ''}${i === todayIndex ? ' gantt-today-col' : ''}`} />
        ))}
        {bars.map((bar) => {
          const start = addDays(bar.start, shiftDays);
          const i = indexOf(start);
          if (i + bar.days <= 0 || i >= days.length) return null;
          return (
            <button key={`${bar.at}-${bar.days}`} type="button" className="gantt-bar"
              style={{ left: i * dayW, width: bar.days * dayW, '--bar': color }}
              title={`${title} · ${formatBar(start, bar.days)}`}
              onPointerDown={(e) => onBarPointer(e, card)}>
              <span>{title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { withoutLinks } from '../links.js';
import { deadlineOnDay, describeDeadline } from '../deadlines.js';
import { cardReminders, timesBetween } from '../reminders.js';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const formatTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Monday-based weeks covering the whole month. */
function monthDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = [];
  for (const d = new Date(start); d <= last || days.length % 7; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  return days;
}

/** Current time, refreshed every minute and when the app comes back to the foreground. */
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}

function ChevronIcon({ left }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={left ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

function Reminder({ card, time, label, columnName, now, onOpen, detailed }) {
  const past = time < now;
  const title = withoutLinks(card.title);
  return (
    <button type="button" className={`cal-card ${past ? 'cal-card-past' : ''}`} onClick={() => onOpen(card.id)}
      title={[label, title, columnName].filter(Boolean).join(' · ')}>
      <span className="cal-card-time">{formatTime(time)}</span>
      <span className="cal-card-title">{title || 'Без названия'}</span>
      {detailed && (label || columnName) && (
        <span className="cal-card-meta">{[label, columnName].filter(Boolean).join(' · ')}</span>
      )}
    </button>
  );
}

function Deadline({ card, label, columnName, now, onOpen, detailed }) {
  const past = card.dueAt < now && !card.done;
  const title = withoutLinks(card.title);
  return (
    <button type="button" className={`cal-card cal-card-due${past ? ' cal-card-past' : ''}`} onClick={() => onOpen(card.id)}
      title={[label, title, columnName, 'Дедлайн'].filter(Boolean).join(' · ')}>
      <span className="cal-card-time">Дедлайн</span>
      <span className="cal-card-title">{title || 'Без названия'}</span>
      {detailed && (
        <span className="cal-card-meta">{[label, columnName, describeDeadline(card.dueAt, new Date(now))].filter(Boolean).join(' · ')}</span>
      )}
    </button>
  );
}

/**
 * Cards with a reminder, by day: a month grid on wide screens, a list of days on narrow ones.
 * `cards` are the cards of the folders in view; `cardLabel` and `columns` describe them.
 */
function DayAddButton({ day, label, onAdd }) {
  return (
    <button type="button" className="cal-day-add" title={label} aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onAdd(day);
      }}>
      +
    </button>
  );
}

/**
 * Cards with a reminder or deadline, by day. `onAddCard(day)` opens a new card with a reminder that day (if set).
 */
export default function CalendarView({ cards, columns, cardLabel, onOpen, onAddCard }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const now = useNow();
  const todayKey = dayKey(new Date(now));
  const columnName = new Map(columns.map((c) => [c.id, c.name]));

  const days = monthDays(month);
  const from = days[0].getTime();
  const to = new Date(days.at(-1).getFullYear(), days.at(-1).getMonth(), days.at(-1).getDate() + 1).getTime();
  const items = cards.filter((c) => !c.deleted).flatMap((card) => {
    const list = [...new Set(cardReminders(card).flatMap((r) => timesBetween(r, from, to)))].map((time) => ({ kind: 'reminder', card, time }));
    if (card.dueAt && deadlineOnDay(card.dueAt, from, to)) list.push({ kind: 'deadline', card, time: card.dueAt });
    return list;
  });
  const byDay = new Map();
  for (const item of items.sort((a, b) => a.time - b.time)) {
    const key = dayKey(new Date(item.time));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  }

  const inMonth = (d) => d.getMonth() === month.getMonth();
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = `${capitalize(month.toLocaleDateString('ru-RU', { month: 'long' }))} ${month.getFullYear()}`;
  const agendaDays = days.filter((d) => inMonth(d));
  const todayRef = useRef(null);
  const viewingCurrentMonth = month.getFullYear() === new Date(now).getFullYear()
    && month.getMonth() === new Date(now).getMonth();

  useEffect(() => {
    if (!viewingCurrentMonth) return;
    todayRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [viewingCurrentMonth, month.getTime()]);

  const entry = (item, detailed) => (item.kind === 'deadline' ? (
    <Deadline key={`${item.card.id}-due`} card={item.card} label={cardLabel?.(item.card)}
      columnName={columnName.get(item.card.columnId)} now={now} onOpen={onOpen} detailed={detailed} />
  ) : (
    <Reminder key={`${item.card.id}-${item.time}`} card={item.card} time={item.time} label={cardLabel?.(item.card)}
      columnName={columnName.get(item.card.columnId)} now={now} onOpen={onOpen} detailed={detailed} />
  ));

  return (
    <main className="calendar">
      <div className="cal-header">
        <button className="btn btn-small btn-icon-only" aria-label="Предыдущий месяц" onClick={() => shift(-1)}>
          <ChevronIcon left />
        </button>
        <h2 className="cal-title">{title}</h2>
        <button className="btn btn-small btn-icon-only" aria-label="Следующий месяц" onClick={() => shift(1)}>
          <ChevronIcon />
        </button>
        <button className="btn btn-small" onClick={() => {
          const d = new Date();
          setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
        }}>Сегодня</button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
        {days.map((d) => {
          const key = dayKey(d);
          const classes = ['cal-day'];
          if (!inMonth(d)) classes.push('cal-day-other');
          if (key === todayKey) classes.push('cal-day-today');
          return (
            <div key={key} className={classes.join(' ')}>
              <div className="cal-day-head">
                <span className="cal-day-number">{d.getDate()}</span>
                {onAddCard && inMonth(d) && (
                  <DayAddButton day={d} label="Новая карточка на этот день" onAdd={onAddCard} />
                )}
              </div>
              {byDay.get(key)?.map((item) => entry(item, false))}
            </div>
          );
        })}
      </div>

      <div className="cal-agenda">
        {agendaDays.map((d) => {
          const key = dayKey(d);
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <section key={key} ref={isToday ? todayRef : undefined}
              className={`cal-agenda-day${isToday ? ' cal-agenda-day-today' : ''}`}
              aria-current={isToday ? 'date' : undefined}>
              <div className="cal-agenda-head">
                <div className="cal-agenda-date">
                  <span className={`cal-agenda-num${isToday ? ' cal-agenda-num-today' : ''}`} aria-hidden="true">
                    {d.getDate()}
                  </span>
                  <div className="cal-agenda-date-text">
                    {isToday && <span className="cal-today-pill">Сегодня</span>}
                    <h3>{capitalize(d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
                  </div>
                </div>
                {onAddCard && (
                  <DayAddButton day={d} label="Новая карточка на этот день" onAdd={onAddCard} />
                )}
              </div>
              {dayItems.length === 0
                ? <p className="cal-agenda-empty muted">Нет карточек</p>
                : dayItems.map((item) => entry(item, true))}
            </section>
          );
        })}
      </div>
    </main>
  );
}

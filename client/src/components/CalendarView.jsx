import { useEffect, useState } from 'react';

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

function Reminder({ card, label, columnName, now, onOpen, detailed }) {
  const past = card.remindAt < now;
  return (
    <button type="button" className={`cal-card ${past ? 'cal-card-past' : ''}`} onClick={() => onOpen(card.id)}
      title={[label, card.title, columnName].filter(Boolean).join(' · ')}>
      <span className="cal-card-time">{formatTime(card.remindAt)}</span>
      <span className="cal-card-title">{card.title || 'Без названия'}</span>
      {detailed && (label || columnName) && (
        <span className="cal-card-meta">{[label, columnName].filter(Boolean).join(' · ')}</span>
      )}
    </button>
  );
}

/**
 * Cards with a reminder, by day: a month grid on wide screens, a list of days on narrow ones.
 * `cards` are the cards of the current project/section; `cardLabel` and `columns` describe them.
 */
export default function CalendarView({ cards, columns, cardLabel, onOpen }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const now = useNow();
  const todayKey = dayKey(new Date(now));
  const columnName = new Map(columns.map((c) => [c.id, c.name]));

  const byDay = new Map();
  for (const card of [...cards].filter((c) => c.remindAt && !c.deleted).sort((a, b) => a.remindAt - b.remindAt)) {
    const key = dayKey(new Date(card.remindAt));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(card);
  }

  const days = monthDays(month);
  const inMonth = (d) => d.getMonth() === month.getMonth();
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const title = `${capitalize(month.toLocaleDateString('ru-RU', { month: 'long' }))} ${month.getFullYear()}`;
  const agendaDays = days.filter((d) => inMonth(d) && byDay.has(dayKey(d)));

  const reminder = (card, detailed) => (
    <Reminder key={card.id} card={card} label={cardLabel?.(card)} columnName={columnName.get(card.columnId)}
      now={now} onOpen={onOpen} detailed={detailed} />
  );

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
              <div className="cal-day-number">{d.getDate()}</div>
              {byDay.get(key)?.map((card) => reminder(card, false))}
            </div>
          );
        })}
      </div>

      <div className="cal-agenda">
        {agendaDays.length === 0 && <p className="muted">В этом месяце нет напоминаний.</p>}
        {agendaDays.map((d) => {
          const key = dayKey(d);
          return (
            <section key={key} className={`cal-agenda-day ${key === todayKey ? 'cal-day-today' : ''}`}>
              <h3>{capitalize(d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }))}</h3>
              {byDay.get(key).map((card) => reminder(card, true))}
            </section>
          );
        })}
      </div>
    </main>
  );
}

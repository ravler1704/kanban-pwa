// Card reminders, shared by the server (push.js) and the client.
// A reminder is { at, repeat, off }: `at` is the first time (Unix ms), `repeat` one of REPEATS
// or null, `off` the UTC offset (minutes) of the device that set it, so repeats keep the same
// wall-clock time wherever they are computed.

export const REPEATS = [
  'daily', 'weekdays', 'weekends', 'weekly', 'biweekly', 'monthly', 'quarterly', 'halfyear', 'yearly',
];
export const MAX_REMINDERS = 20;

const DAY = 86_400_000;
const STEP_DAYS = { daily: 1, weekdays: 1, weekends: 1, weekly: 7, biweekly: 14 };
const STEP_MONTHS = { monthly: 1, quarterly: 3, halfyear: 6, yearly: 12 };

export function isReminder(r) {
  return r !== null && typeof r === 'object' && !Array.isArray(r)
    && Object.keys(r).every((k) => k === 'at' || k === 'repeat' || k === 'off')
    && Number.isInteger(r.at) && r.at > 0
    && (r.repeat === null || REPEATS.includes(r.repeat))
    && Number.isInteger(r.off) && Math.abs(r.off) <= 14 * 60;
}

export const isReminderList = (v) => Array.isArray(v) && v.length <= MAX_REMINDERS && v.every(isReminder);

/** A reminder at `at`, with the offset of this device. */
export const makeReminder = (at, repeat = null) => ({ at, repeat, off: -new Date(at).getTimezoneOffset() });

/** The card's reminders, including the single `remindAt` of cards saved before the list. */
export function cardReminders(card) {
  if (card?.reminders?.length) return card.reminders;
  return card?.remindAt ? [makeReminder(card.remindAt)] : [];
}

const wall = (r, t) => new Date(t + r.off * 60_000);

function addMonths(r, months) {
  const w = wall(r, r.at);
  const y = w.getUTCFullYear();
  const m = w.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(w.getUTCDate(), last), w.getUTCHours(), w.getUTCMinutes()) - r.off * 60_000;
}

function fits(r, t) {
  const day = wall(r, t).getUTCDay();
  if (r.repeat === 'weekdays') return day !== 0 && day !== 6;
  if (r.repeat === 'weekends') return day === 0 || day === 6;
  return true;
}

/** The first time of the reminder at or after `t`, null if there is none. */
export function nextTime(r, t) {
  if (!r.repeat) return r.at >= t ? r.at : null;
  const from = Math.max(t, r.at);
  const months = STEP_MONTHS[r.repeat];
  if (months) {
    let k = Math.max(0, Math.floor((from - r.at) / (31 * DAY) / months) - 1) * months;
    while (addMonths(r, k) < from) k += months;
    return addMonths(r, k);
  }
  const step = STEP_DAYS[r.repeat] * DAY;
  for (let time = r.at + Math.ceil((from - r.at) / step) * step; ; time += step) {
    if (fits(r, time)) return time;
  }
}

/** Times of the reminder in [from, to), at most `limit`. */
export function timesBetween(r, from, to, limit = 100) {
  const times = [];
  for (let t = nextTime(r, from); t !== null && t < to && times.length < limit; t = nextTime(r, t + 1)) times.push(t);
  return times;
}

/**
 * The card's nearest reminder from `now`: { time, repeat, past }. With no upcoming one, the latest
 * past one (past: true); null without reminders.
 */
export function nextReminder(card, now) {
  let best = null;
  let latestPast = null;
  for (const r of cardReminders(card)) {
    const time = nextTime(r, now);
    if (time !== null) {
      if (!best || time < best.time) best = { time, repeat: r.repeat, past: false };
    } else if (!latestPast || r.at > latestPast.time) {
      latestPast = { time: r.at, repeat: null, past: true };
    }
  }
  return best ?? latestPast;
}

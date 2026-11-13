/** End of the calendar day in local time (23:59:59.999). */
export function endOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** «Сегодня», «Завтра», «пт, 7 нояб.» — the deadline date without time. */
export function describeDeadline(at, now = new Date()) {
  if (!at) return '';
  const date = new Date(at);
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Завтра';
  if (days === -1) return 'Вчера';
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('ru-RU', options);
}

export function isDeadlineOverdue(dueAt, now = Date.now(), done = false) {
  if (!dueAt || done) return false;
  return now > dueAt;
}

export function deadlineOnDay(dueAt, from, to) {
  if (!dueAt) return false;
  const day = startOfDay(new Date(dueAt)).getTime();
  return day >= startOfDay(new Date(from)).getTime() && day < to;
}

// Notes of changes the server writes into a project's chat: a comment whose `event` is JSON
// { k: kind, card: { id, title }, ... } (see recordEvents in server/src/sync.js).

const q = (name) => `«${name?.trim() || 'Без названия'}»`;
const cardName = (card) => `${card.number ? `#${card.number} ` : ''}${q(card.title)}`;

const remindTime = (at) => new Date(at).toLocaleString('ru-RU', {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

/** The sentence as strings and the card ({ card }), which may become a link. */
function parts(e) {
  const card = { card: e.card };
  switch (e.k) {
    case 'card.create': return ['Создана карточка ', card, e.column ? ` в колонке ${q(e.column)}` : ''];
    case 'card.delete': return ['Удалена карточка ', card];
    case 'card.restore': return ['Восстановлена карточка ', card];
    case 'card.rename': return [`Карточка ${q(e.from)} переименована в `, card];
    case 'card.column': return ['Карточка ', card, ` перемещена: ${q(e.from)} → ${q(e.to)}`];
    case 'card.section': return e.to
      ? ['Карточка ', card, ` перенесена в раздел ${q(e.to)}`]
      : ['Карточка ', card, ` вынесена из раздела ${q(e.from)}`];
    case 'card.out': return ['Карточка ', card, ` перенесена в проект ${q(e.project)}`];
    case 'card.in': return ['Карточка ', card, ` перенесена из проекта ${q(e.project)}`];
    case 'card.description': return ['Изменено описание карточки ', card];
    case 'card.remind': return e.at
      ? ['Напоминание по карточке ', card, `: ${remindTime(e.at)}`]
      : ['Убрано напоминание по карточке ', card];
    case 'card.file.add': return [`Прикреплён файл ${q(e.name)} к карточке `, card];
    case 'card.file.remove': return [`Удалён файл ${q(e.name)} из карточки `, card];
    case 'section.create': return [`Создан раздел ${q(e.name)}`];
    case 'section.delete': return [`Удалён раздел ${q(e.name)}`];
    case 'section.restore': return [`Восстановлен раздел ${q(e.name)}`];
    case 'section.rename': return [`Раздел ${q(e.from)} переименован в ${q(e.name)}`];
    case 'project.create': return [`Создан проект ${q(e.name)}`];
    case 'project.rename': return [`Проект ${q(e.from)} переименован в ${q(e.name)}`];
    case 'project.columns': return [`Проекту назначен набор колонок ${q(e.name)}`];
    default: return ['Изменения в проекте'];
  }
}

export function parseEvent(json) {
  try {
    const e = JSON.parse(json);
    return e && typeof e === 'object' ? e : null;
  } catch {
    return null;
  }
}

/** The message as plain text: a note of a change is described in words. */
export function messageText(m) {
  const e = m.event && parseEvent(m.event);
  if (!e) return m.text;
  return parts(e).map((p) => (typeof p === 'string' ? p : cardName(p.card ?? {}))).join('');
}

/** The note `event` (parsed); the card's title opens it with `onOpenCard(id)`. */
export function EventText({ event, onOpenCard }) {
  return parts(event).map((p, i) => {
    if (typeof p === 'string') return p;
    if (!p.card) return null;
    return onOpenCard
      ? <button key={i} type="button" className="chat-event-card" onClick={() => onOpenCard(p.card.id)}>{cardName(p.card)}</button>
      : <strong key={i}>{cardName(p.card)}</strong>;
  });
}

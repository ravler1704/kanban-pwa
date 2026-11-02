import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db.js';
import { withoutLinks } from './links.js';

// Notes of changes the server writes into a folder's chat: a comment whose `event` is JSON
// { k: kind, card: { id, title, number }, ... } (see recordEvents in server/src/sync.js).
// Notes from before card numbers existed have none; `numbers` (card id → number) fills it in.

const q = (name) => `«${withoutLinks(name).trim() || 'Без названия'}»`;

function cardName(card, numbers) {
  const number = card.number ?? numbers?.get(card.id);
  return `${number ? `#${number} ` : ''}${q(card.title)}`;
}

/** Card id → number of the board's cards (deleted ones too). */
export function useCardNumbers() {
  return useLiveQuery(async () => {
    const numbers = new Map();
    await db.cards.each((c) => {
      if (c.number) numbers.set(c.id, c.number);
    });
    return numbers;
  }, []);
}

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
    case 'card.out': return ['Карточка ', card, ` перенесена в папку ${q(e.folder ?? e.project)}`];
    case 'card.in': return ['Карточка ', card, ` перенесена из папки ${q(e.folder ?? e.project)}`];
    case 'card.description': return ['Изменено описание карточки ', card];
    case 'card.remind': return e.at
      ? ['Напоминание по карточке ', card, `: ${remindTime(e.at)}`]
      : ['Убрано напоминание по карточке ', card];
    case 'card.file.add': return [`Прикреплён файл ${q(e.name)} к карточке `, card];
    case 'card.file.remove': return [`Удалён файл ${q(e.name)} из карточки `, card];
    case 'folder.create': return [`Создана папка ${q(e.name)}`];
    case 'folder.child': return [`Внутри создана папка ${q(e.name)}`];
    case 'folder.rename': return [`Папка ${q(e.from)} переименована в ${q(e.name)}`];
    case 'folder.delete': return [`Удалена папка ${q(e.name)}`];
    case 'folder.restore': return [`Восстановлена папка ${q(e.name)}`];
    case 'folder.columns': return [e.name ? `Папке назначен набор колонок ${q(e.name)}` : 'Папка берёт набор колонок у родителя'];
    case 'folder.out': return [e.folder
      ? `Папка ${q(e.name)} перенесена в папку ${q(e.folder)}`
      : `Папка ${q(e.name)} перенесена на верхний уровень`];
    case 'folder.in': return [e.folder
      ? `Папка ${q(e.name)} перенесена сюда из папки ${q(e.folder)}`
      : `Папка ${q(e.name)} перенесена сюда с верхнего уровня`];
    // Notes written before folders replaced sections, projects and spaces.
    case 'section.create': return [`Создан раздел ${q(e.name)}`];
    case 'section.delete': return [`Удалён раздел ${q(e.name)}`];
    case 'section.restore': return [`Восстановлен раздел ${q(e.name)}`];
    case 'section.rename': return [`Раздел ${q(e.from)} переименован в ${q(e.name)}`];
    case 'project.create': return [`Создан проект ${q(e.name)}`];
    case 'project.rename': return [`Проект ${q(e.from)} переименован в ${q(e.name)}`];
    case 'project.columns': return [`Проекту назначен набор колонок ${q(e.name)}`];
    case 'project.space': return [`Проект перенесён в пространство ${q(e.name)}`];
    case 'project.delete': return [`Удалён проект ${q(e.name)}`];
    case 'project.restore': return [`Восстановлен проект ${q(e.name)}`];
    case 'project.out': return [`Проект ${q(e.name)} перенесён в пространство ${q(e.space)}`];
    case 'project.in': return [`Проект ${q(e.name)} перенесён сюда из пространства ${q(e.space)}`];
    case 'space.create': return [`Создано пространство ${q(e.name)}`];
    case 'space.rename': return [`Пространство ${q(e.from)} переименовано в ${q(e.name)}`];
    default: return ['Изменения в папке'];
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
export function messageText(m, numbers) {
  const e = m.event && parseEvent(m.event);
  if (!e) return m.text;
  return parts(e).map((p) => (typeof p === 'string' ? p : cardName(p.card ?? {}, numbers))).join('');
}

/** What the change of a text was (`event.diff`: [[op, text], ...], op -1 removed, 1 added, 0 kept). */
export function EventDiff({ diff }) {
  if (!Array.isArray(diff)) return null;
  return (
    <div className="chat-event-diff">
      {diff.map(([op, text], i) => {
        if (op === -1) return <del key={i}>{text}</del>;
        if (op === 1) return <ins key={i}>{text}</ins>;
        return <span key={i}>{text}</span>;
      })}
    </div>
  );
}

/** The note `event` (parsed); the card's title opens it with `onOpenCard(id)`. */
export function EventText({ event, numbers, onOpenCard }) {
  return parts(event).map((p, i) => {
    if (typeof p === 'string') return p;
    if (!p.card) return null;
    const name = cardName(p.card, numbers);
    return onOpenCard
      ? <button key={i} type="button" className="chat-event-card" onClick={() => onOpenCard(p.card.id)}>{name}</button>
      : <strong key={i}>{name}</strong>;
  });
}

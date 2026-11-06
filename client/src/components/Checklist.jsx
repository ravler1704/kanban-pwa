import { useEffect, useRef, useState } from 'react';
import { updateCard } from '../actions.js';
import { newId } from '../db.js';

const MAX_TEXT = 500;
const MAX_ITEMS = 200;

/** The text of a subtask turned into a field by a click: Enter or leaving it saves, Escape cancels. */
function ItemField({ value, onSave, onDone }) {
  const [draft, setDraft] = useState(value);
  const input = useRef(null);
  const done = useRef(false);
  // Opened by a click on the text.
  useEffect(() => input.current.focus(), []);
  const finish = (save) => {
    if (done.current) return;
    done.current = true;
    const text = draft.trim().slice(0, MAX_TEXT);
    if (save && text !== value) onSave(text);
    onDone();
  };
  return (
    <input ref={input} className="checklist-input" value={draft} maxLength={MAX_TEXT} aria-label="Подзадача"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') finish(false);
      }} />
  );
}

/**
 * The card's subtasks: ticked, added, renamed and removed right away, apart from the card's «Сохранить».
 * `onCollapse` hides the empty section.
 */
export default function Checklist({ card, readOnly, onCollapse }) {
  const items = card.checklist ?? [];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  if (readOnly && !items.length) return null;

  const save = (next) => updateCard(card.id, { checklist: next });
  const change = (id, patch) => save(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id) => save(items.filter((i) => i.id !== id));
  const add = () => {
    const text = draft.trim().slice(0, MAX_TEXT);
    if (!text || items.length >= MAX_ITEMS) return;
    save([...items, { id: newId(), text, done: false }]);
    setDraft('');
  };
  const doneCount = items.filter((i) => i.done).length;

  return (
    <section className="checklist" aria-label="Подзадачи">
      <div className="attachments-head">
        <span className="attachments-title">Подзадачи{items.length > 0 && ` · ${doneCount} из ${items.length}`}</span>
        {onCollapse && !items.length && <button type="button" className="btn btn-small" onClick={onCollapse}>Убрать</button>}
      </div>
      {items.length > 0 && (
        <div className={`checklist-progress ${doneCount === items.length ? 'checklist-progress-full' : ''}`} aria-hidden="true">
          <span style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      )}
      {items.length > 0 && (
        <ul className="checklist-items">
          {items.map((item) => (
            <li key={item.id} className={`checklist-item ${item.done ? 'checklist-done' : ''}`}>
              <input type="checkbox" checked={item.done} disabled={readOnly} aria-label={item.text}
                onChange={() => change(item.id, { done: !item.done })} />
              {editing === item.id ? (
                <ItemField value={item.text} onDone={() => setEditing(null)}
                  onSave={(text) => (text ? change(item.id, { text }) : remove(item.id))} />
              ) : (
                <span className="checklist-text" title={readOnly ? undefined : 'Нажмите, чтобы изменить'}
                  onClick={() => !readOnly && setEditing(item.id)}>{item.text}</span>
              )}
              {!readOnly && (
                <button type="button" className="attachment-remove" title="Удалить подзадачу"
                  aria-label={`Удалить подзадачу «${item.text}»`} onClick={() => remove(item.id)}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && items.length < MAX_ITEMS && (
        <div className="checklist-add">
          <input className="manage-input" placeholder="Новая подзадача" value={draft} maxLength={MAX_TEXT}
            aria-label="Новая подзадача"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              add();
            }} />
          <button type="button" className={`btn btn-small ${draft.trim() ? 'btn-primary' : ''}`} disabled={!draft.trim()}
            onClick={add}>Добавить</button>
        </div>
      )}
    </section>
  );
}

import { useEffect, useSyncExternalStore } from 'react';
import { archiveCards, restoreCards, setCardDone, updateCard } from '../actions.js';
import { db, INBOX_ID } from '../db.js';

const SHOW_MS = 7000;
// The tick's animation plays out before a done card of «Входящие» goes.
const DONE_ARCHIVE_MS = 650;

// One note at a time, as Trello's: a newer one replaces it.
let current = null;
const listeners = new Set();
const set = (value) => {
  current = value;
  listeners.forEach((l) => l());
};
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Shows `text` at the bottom left for a while, with «Отменить» calling `undo()`. */
export function showUndo(text, undo) {
  set({ id: Date.now() + Math.random(), text, undo });
}

/** Archives the cards right away; the note that follows lets the user take it back. */
export async function archiveWithUndo(ids) {
  if (!ids.length) return;
  await archiveCards(ids);
  showUndo(ids.length === 1 ? 'Карточка архивирована' : `Архивировано карточек: ${ids.length}`, () => restoreCards(ids));
}

/** Marks the card done or not; a card of «Входящие» marked done is archived right after, with the undo note. */
export async function markDone(card, done) {
  await setCardDone(card.id, done);
  if (!done || card.folderId !== INBOX_ID) return;
  setTimeout(async () => {
    const now = await db.cards.get(card.id);
    if (!now?.done || now.deleted || now.folderId !== INBOX_ID) return;
    await archiveCards([card.id]);
    showUndo('Выполнена и архивирована', () => updateCard(card.id, { deleted: false, done: false }));
  }, DONE_ARCHIVE_MS);
}

export default function UndoToast() {
  const note = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => current === note && set(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [note]);
  if (!note) return null;
  return (
    <div key={note.id} className="undo-toast" role="status">
      <span className="undo-toast-text">{note.text}</span>
      <button type="button" className="undo-toast-btn" onClick={() => {
        set(null);
        note.undo();
      }}>Отменить</button>
      <button type="button" className="undo-toast-close" title="Закрыть" aria-label="Закрыть" onClick={() => set(null)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

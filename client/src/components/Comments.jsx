import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addComment, deleteComment, editComment } from '../actions.js';
import { authState } from '../auth.js';
import { parseEvent } from '../chatEvents.jsx';
import { isOwnBoard, publicToken } from '../board.js';
import { db } from '../db.js';
import { markSeen, threadOf } from '../seen.js';
import ChatThread from './ChatThread.jsx';

/** Comments shown as a chat message: unsynced ones are marked. */
const toMessage = (c) => ({ ...c, pending: Boolean(c.dirty && !c.server) });

/**
 * Notes about the card from its folders' chats. A move between folders is noted in both; the
 * note in the new folder is dropped when the one in the old folder is here too.
 */
async function cardEvents(cardId) {
  const notes = await db.comments
    .filter((c) => !c.cardId && Boolean(c.event?.includes(cardId)) && parseEvent(c.event)?.card?.id === cardId)
    .toArray();
  const outs = notes.filter((c) => parseEvent(c.event).k === 'card.out').map((c) => c.createdAt);
  return notes.filter((c) => parseEvent(c.event).k !== 'card.in'
    || !outs.some((at) => Math.abs(at - c.createdAt) < 1000));
}

/**
 * Live comments of a thread: the card `cardId` (with the notes of what was done with it), or with
 * cardId null the chat of the folder `folderId`. Reading them marks the thread read on this device.
 */
export function useComments({ cardId, folderId }) {
  const comments = useLiveQuery(async () => {
    if (cardId) return [...await db.comments.where('cardId').equals(cardId).toArray(), ...await cardEvents(cardId)];
    return db.comments.where('folderId').equals(folderId).filter((c) => !c.cardId).toArray();
  }, [cardId, folderId]);
  const live = (comments ?? []).filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
  const latest = live[live.length - 1]?.createdAt ?? 0;
  const thread = threadOf({ cardId, folderId });
  useEffect(() => {
    if (latest) markSeen(thread, latest);
  }, [thread, latest]);
  return comments ? live.map(toMessage) : null;
}

const HISTORY_HIDDEN_KEY = 'cardHistoryHidden';
const historyListeners = new Set();
const historyStore = {
  subscribe(listener) {
    historyListeners.add(listener);
    return () => historyListeners.delete(listener);
  },
  hidden: () => localStorage.getItem(HISTORY_HIDDEN_KEY) === '1',
  toggle() {
    localStorage.setItem(HISTORY_HIDDEN_KEY, historyStore.hidden() ? '0' : '1');
    historyListeners.forEach((l) => l());
  },
};

/** Whether the notes of what was done with a card are hidden in its chat, on this device. */
const useHistoryHidden = () => useSyncExternalStore(historyStore.subscribe, historyStore.hidden);

/** Shows or hides the notes in card chats. */
export function HistoryToggle() {
  const hidden = useHistoryHidden();
  return (
    <button type="button" className={`btn btn-small history-toggle ${hidden ? '' : 'active'}`}
      aria-pressed={!hidden} onClick={historyStore.toggle}
      title={hidden ? 'Показать действия с карточкой' : 'Скрыть действия с карточкой'}>
      История
    </button>
  );
}

/**
 * The chat of a card (`card`) or a folder (`folderId`). Signed-in people write;
 * through a public link comments are only shown. The board's owner may delete anyone's.
 */
export default function Comments({ card, folderId, title, className, placeholder, onOpenCard }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const where = card ? { cardId: card.id, folderId: card.folderId } : { cardId: null, folderId };
  const all = useComments(where);
  const historyHidden = useHistoryHidden();
  const me = user?.id ?? '';
  const canWrite = !publicToken;

  if (!all) return null;
  const messages = card && historyHidden ? all.filter((m) => !m.event) : all;
  if (!canWrite && messages.length === 0) return null;

  const thread = (
    <ChatThread
      className={className}
      messages={messages}
      me={me}
      placeholder={placeholder ?? 'Комментарий'}
      empty={card ? 'Комментариев пока нет.' : 'Сообщений пока нет — напишите первым.'}
      onSend={canWrite ? (text, images) => addComment(where, text, user, images) : null}
      onEdit={canWrite ? (m, text) => editComment(m.id, text) : null}
      onDelete={canWrite ? (m) => deleteComment(m.id) : null}
      canDelete={(m) => m.authorId === me || isOwnBoard}
      onOpenCard={onOpenCard}
    />
  );
  if (!title) return thread;
  const count = messages.filter((m) => !m.event).length;
  return (
    <section className="comments">
      <div className="comments-head">
        <h4>{title}{count > 0 && <span className="muted"> · {count}</span>}</h4>
        {card && <HistoryToggle />}
      </div>
      {thread}
    </section>
  );
}

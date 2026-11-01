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
 * Notes about the card from its projects' chats. A move between projects is noted in both; the
 * note in the new project is dropped when the one in the old project is here too.
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
 * cardId null the chat of `projectId` or `spaceId`. Reading them marks the thread read on this device.
 */
export function useComments({ cardId, projectId, spaceId }) {
  const comments = useLiveQuery(async () => {
    if (cardId) return [...await db.comments.where('cardId').equals(cardId).toArray(), ...await cardEvents(cardId)];
    if (spaceId) return db.comments.filter((c) => c.spaceId === spaceId).toArray();
    return db.comments.where('projectId').equals(projectId).filter((c) => !c.cardId).toArray();
  }, [cardId, projectId, spaceId]);
  const live = (comments ?? []).filter((c) => !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
  const latest = live[live.length - 1]?.createdAt ?? 0;
  const thread = threadOf({ cardId, projectId, spaceId });
  useEffect(() => {
    if (latest) markSeen(thread, latest);
  }, [thread, latest]);
  return comments ? live.map(toMessage) : null;
}

/**
 * The chat of a card (`card`), a project (`projectId`) or a space (`spaceId`). Signed-in people write;
 * through a public link comments are only shown. The board's owner may delete anyone's.
 */
export default function Comments({ card, projectId, spaceId, title, className, placeholder, onOpenCard }) {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const where = card ? { cardId: card.id, projectId: card.projectId }
    : spaceId ? { cardId: null, projectId: null, spaceId } : { cardId: null, projectId };
  const messages = useComments(where);
  const me = user?.id ?? '';
  const canWrite = !publicToken;

  if (!messages) return null;
  if (!canWrite && messages.length === 0) return null;

  const thread = (
    <ChatThread
      className={className}
      messages={messages}
      me={me}
      placeholder={placeholder ?? 'Комментарий'}
      empty={card ? 'Комментариев пока нет.' : 'Сообщений пока нет — напишите первым.'}
      onSend={canWrite ? (text) => addComment(where, text, user) : null}
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
      <h4>{title}{count > 0 && <span className="muted"> · {count}</span>}</h4>
      {thread}
    </section>
  );
}

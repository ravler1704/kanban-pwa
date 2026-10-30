import { useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addComment, deleteComment, editComment } from '../actions.js';
import { authState } from '../auth.js';
import { isOwnBoard, publicToken } from '../board.js';
import { db } from '../db.js';
import { markSeen, threadOf } from '../seen.js';
import ChatThread from './ChatThread.jsx';

/** Comments shown as a chat message: unsynced ones are marked. */
const toMessage = (c) => ({ ...c, pending: Boolean(c.dirty && !c.server) });

/**
 * Live comments of a thread: the card `cardId`, or with cardId null the chat of `projectId` or
 * `spaceId`. Reading them marks the thread read on this device.
 */
export function useComments({ cardId, projectId, spaceId }) {
  const comments = useLiveQuery(() => {
    if (cardId) return db.comments.where('cardId').equals(cardId).toArray();
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
  return (
    <section className="comments">
      <h4>{title}{messages.length > 0 && <span className="muted"> · {messages.length}</span>}</h4>
      {thread}
    </section>
  );
}

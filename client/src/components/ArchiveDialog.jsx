import { useLiveQuery } from 'dexie-react-hooks';
import { purgeCards, restoreCard } from '../actions.js';
import { db, INBOX_ID } from '../db.js';
import Modal from './Modal.jsx';

const PURGE_NOTE = 'Её комментарии, история изменений и файлы будут стёрты без возможности восстановления.';

const deletedAt = (card) => card.server?.updatedAt ?? Date.now();
const formatDate = (time) => new Date(time).toLocaleString('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Archived (deleted) cards of `folders` (and of «Входящие»), last deleted first: each may be restored where it was or deleted
 * for good — then the server wipes it with its comments, history and files. Cards of deleted boards are not here.
 */
export default function ArchiveDialog({ folders, onClose }) {
  const names = new Map([[INBOX_ID, 'Входящие'], ...folders.map((f) => [f.id, f.name])]);
  const cards = useLiveQuery(
    async () => (await db.cards.filter((c) => c.deleted && !c.purged && !c.conflict).toArray())
      .sort((a, b) => deletedAt(b) - deletedAt(a)),
    [],
  );
  const shown = (cards ?? []).filter((c) => names.has(c.folderId));

  const purge = (card) => {
    if (confirm(`Удалить карточку «${card.title}» навсегда? ${PURGE_NOTE}`)) purgeCards([card.id]);
  };
  const purgeAll = () => {
    const note = 'Их комментарии, история изменений и файлы будут стёрты без возможности восстановления.';
    if (confirm(`Удалить навсегда все карточки архива (${shown.length})? ${note}`)) purgeCards(shown.map((c) => c.id));
  };

  return (
    <Modal title="Архив" onClose={onClose} className="archive-dialog" closeButton>
      <p className="muted archive-note">
        Здесь архивированные карточки. Карточку можно восстановить на её доску или удалить навсегда — вместе
        с комментариями, историей и файлами.
      </p>
      {cards && shown.length === 0 && <p className="muted">Архив пуст.</p>}
      {shown.length > 0 && (
        <ul className="archive-list">
          {shown.map((card) => (
            <li key={card.id} className="archive-item">
              <div className="archive-text">
                <span className="archive-title">
                  {card.number ? <span className="muted">#{card.number} </span> : null}
                  {card.title || 'Без названия'}
                </span>
                <span className="archive-meta muted">{names.get(card.folderId)} · архивирована {formatDate(deletedAt(card))}</span>
              </div>
              <div className="archive-actions">
                <button type="button" className="btn btn-small" onClick={() => restoreCard(card.id)}>Восстановить</button>
                <button type="button" className="btn btn-small btn-danger" onClick={() => purge(card)}>Удалить навсегда</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {shown.length > 0 && <button type="button" className="btn btn-danger archive-clear" onClick={purgeAll}>Очистить архив</button>}
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

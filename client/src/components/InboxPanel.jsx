import { useContext, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { createInboxCard, deleteCard, moveCardTo } from '../actions.js';
import { setInboxDoneMarks } from '../auth.js';
import { db, INBOX_ID } from '../db.js';
import { DoneMarks } from '../doneMarks.js';
import { ICONS } from '../menuIcons.js';
import { syncStatus } from '../sync.js';
import { DoneButton, setDraggedCard } from './Card.jsx';
import ContextMenu, { useMenuButton } from './ContextMenu.jsx';
import { SwitchRow } from './FolderFilter.jsx';
import { FolderPickerDialog } from './FolderSelect.jsx';
import Markdown from './Markdown.jsx';
import Modal from './Modal.jsx';
import { useOpenSpace } from './Spaces.jsx';

const svg = (children) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** A tray: what lands in «Входящие». */
export function InboxIcon() {
  return svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></>);
}
const MoveIcon = () => svg(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>);
const DeleteIcon = () => svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>);
const CloseIcon = () => svg(<path d="M18 6 6 18M6 6l12 12" />);

const MoreIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);

/** Settings of the user's own «Входящие» (kept on the server, so they need the connection). */
function InboxSettings({ onClose }) {
  const space = useOpenSpace();
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const on = space.inboxDoneMarks ?? space.doneMarks;

  async function change(value) {
    setBusy(true);
    setError(null);
    try {
      await setInboxDoneMarks(space.id, value === space.doneMarks ? null : value);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Настройки «Входящих»" onClose={onClose} className="folder-picker board-settings" closeButton>
      <ul className="fp-list ff-group">
        <SwitchRow label="Отметка «Выполнена» у карточек" on={on} disabled={!online || busy}
          meta={space.inboxDoneMarks === null ? 'Как у пространства' : 'Своя настройка «Входящих»'} onChange={change} />
      </ul>
      {!online && <p className="muted">Изменить настройки можно только при подключении к интернету.</p>}
      {error && <p className="login-error">{error}</p>}
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

/** The live cards in «Входящие», in their order. */
export function useInboxCards() {
  return useLiveQuery(
    async () => (await db.cards.where('folderId').equals(INBOX_ID).toArray())
      .filter((c) => !c.deleted)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [],
  );
}

/**
 * «Входящие»: cards dumped quickly, to be sorted out onto `folders` later — dragged to a column of the board
 * (the panel doesn't cover it) or moved with «На доску». `onOpen(id)` opens a card.
 */
export default function InboxPanel({ folders, onOpen, onClose }) {
  const cards = useInboxCards() ?? [];
  const [title, setTitle] = useState('');
  const [moving, setMoving] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu, closeMenu, menuButton] = useMenuButton(240);
  const doneMarksOf = useContext(DoneMarks);
  const menuItems = [{ label: 'Настройки «Входящих»…', icon: ICONS.gear, run: () => setSettingsOpen(true) }];
  // A card of the board dragged over the panel: it goes back to «Входящие» on the drop.
  const [dropping, setDropping] = useState(false);
  const fromBoard = (e) => e.dataTransfer.types.includes('text/card-id') && !e.dataTransfer.types.includes('text/inbox');

  function add(e) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    createInboxCard(value);
    setTitle('');
  }

  return (
    <aside className={`inbox ${dropping ? 'inbox-drop' : ''}`} aria-label="Входящие"
      onContextMenu={(e) => {
        // Menus and dialogs portaled from inside bubble here too.
        if (!e.currentTarget.contains(e.target) || e.target.closest('.inbox-card, a, button, input, textarea')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onDragOver={(e) => {
        if (!fromBoard(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        if (!fromBoard(e)) return;
        e.preventDefault();
        moveCardTo(e.dataTransfer.getData('text/card-id'), INBOX_ID);
      }}>
      <div className="inbox-head">
        <button type="button" className="btn btn-small btn-icon-only inbox-head-btn" title="Закрыть" aria-label="Закрыть"
          onClick={onClose}>
          <CloseIcon />
        </button>
        <h2 className="inbox-title"><InboxIcon /> Входящие</h2>
        <button type="button" className={`btn btn-small btn-icon-only inbox-head-btn ${menu ? 'active' : ''}`} title="Действия"
          aria-label="Действия с «Входящими»" {...menuButton}>
          <MoreIcon />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {settingsOpen && createPortal(<InboxSettings onClose={() => setSettingsOpen(false)} />, document.body)}
      <form className="add-card inbox-add" onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="+ Быстро записать дело"
          aria-label="Новое дело" maxLength={500} />
      </form>
      {cards.length ? (
        <ul className="inbox-list">
          {cards.map((card) => (
            <li key={card.id} className="inbox-card" draggable
              onDragStart={(e) => {
                setDraggedCard(card.id, e.currentTarget.offsetHeight);
                e.dataTransfer.setData('text/card-id', card.id);
                e.dataTransfer.setData('text/inbox', '1');
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDraggedCard(null)}>
              <div className={`card-title-row inbox-title-row${doneMarksOf(card) ? ' card-title-row-done' : ''}`}>
                {doneMarksOf(card) && <DoneButton card={card} className="card-done-btn" />}
                <button type="button" className="inbox-card-title done-slide" onClick={() => onOpen(card.id)}>
                  {card.title ? <Markdown text={card.title} inline /> : <em className="muted">Без названия</em>}
                </button>
              </div>
              <span className="inbox-card-actions">
                <button type="button" className="btn btn-small btn-icon-only" title="На доску…" aria-label="На доску"
                  disabled={!folders.length} onClick={() => setMoving(card.id)}>
                  <MoveIcon />
                </button>
                <button type="button" className="btn btn-small btn-icon-only" title="Удалить" aria-label="Удалить"
                  onClick={() => confirm('Удалить карточку?') && deleteCard(card.id)}>
                  <DeleteIcon />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="inbox-empty muted">
          Записывайте сюда дела, не думая, куда их деть. Потом перетащите каждое в колонку доски
          или перенесите кнопкой «На доску». Карточку с доски можно вернуть сюда перетаскиванием
          или пунктом «Во „Входящие“» в её меню.
        </p>
      )}
      {moving && createPortal(
        <FolderPickerDialog title="На доску" folders={folders} value={null}
          onPick={(folderId) => moveCardTo(moving, folderId)} onClose={() => setMoving(null)} />,
        document.body,
      )}
    </aside>
  );
}

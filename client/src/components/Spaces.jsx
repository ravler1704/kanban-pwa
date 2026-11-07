import { useRef, useState, useSyncExternalStore } from 'react';
import { authState, createSpace, deleteSpace, renameSpace, setSpaceDoneMarks } from '../auth.js';
import { boardName, boardOwnerName, currentBoard, switchBoard } from '../board.js';
import { ICONS } from '../menuIcons.js';
import { personName } from '../people.js';
import { syncStatus } from '../sync.js';
import ContextMenu from './ContextMenu.jsx';
import { SwitchRow } from './FolderFilter.jsx';
import Modal from './Modal.jsx';

const MAIN_NAME = 'Моё пространство';

/** The user's spaces, the main one first (a server from before spaces sends none). */
const spacesOf = (user) => (user?.spaces?.length ? user.spaces : [{ id: user?.id, name: MAIN_NAME, main: true }]);

/**
 * The open space: { id, title, subtitle, own (one of the user's: { id, name, doneMarks, main? }), doneMarks
 * (whether cards can be marked done on boards that don't say otherwise), inboxDoneMarks (the same for the
 * user's own «Входящие»: true / false, null → as the space) }.
 */
export function useOpenSpace() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const own = spacesOf(user).find((s) => (currentBoard ? s.id === currentBoard : s.main)) ?? null;
  if (own) {
    return {
      id: own.id, title: own.name, subtitle: user ? personName(user) : '', own,
      doneMarks: own.doneMarks !== false, inboxDoneMarks: own.inboxDoneMarks ?? null,
    };
  }
  const shared = (user?.boards ?? []).find((b) => b.id === currentBoard);
  return {
    id: currentBoard,
    title: shared ? boardName(shared) : 'Общее пространство',
    subtitle: shared ? `владелец: ${boardOwnerName(shared)}` : '',
    own: null,
    doneMarks: shared?.doneMarks !== false,
    inboxDoneMarks: shared?.inboxDoneMarks ?? null,
  };
}

function ChevronIcon() {
  return (
    <svg className="space-switch-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  );
}

function NewSpaceDialog({ onClose }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createSpace(name.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Новое пространство" onClose={onClose} className="space-dialog">
      <form onSubmit={submit}>
        <p className="muted account-hint">
          У пространства свои доски, колонки, карточки и участники. Переключаться между пространствами — по
          нажатию на название вверху экрана.
        </p>
        <label className="field manage-field">
          <span className="field-label">Название</span>
          <input className="manage-input" value={name} maxLength={100} placeholder="Например, «Работа»"
            onChange={(e) => setName(e.target.value)} />
        </label>
        {!online && <p className="muted">Создать пространство можно только при подключении к интернету.</p>}
        {error && <p className="login-error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !online || !name.trim()}>Создать</button>
        </div>
      </form>
    </Modal>
  );
}

/** The open space's name in the header, the user's (or the owner's) name under it; a click lists the spaces. */
export function SpaceSwitcher() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const { title, subtitle, own } = useOpenSpace();
  const [menu, setMenu] = useState(null);
  const [creating, setCreating] = useState(false);
  const boards = user?.boards ?? [];

  const items = [
    ...spacesOf(user).map((s) => ({
      key: s.id, label: s.name, active: s.id === own?.id, run: () => s.id !== own?.id && switchBoard(s.main ? null : s.id),
    })),
    { key: 'new', label: 'Новое пространство…', icon: ICONS.add, run: () => setCreating(true) },
    ...(boards.length ? [null] : []),
    ...boards.map((b) => ({
      key: b.id, label: boardName(b), hint: boardOwnerName(b), title: `Владелец: ${boardOwnerName(b)}`,
      active: b.id === currentBoard, run: () => b.id !== currentBoard && switchBoard(b.id),
    })),
  ];

  return (
    <>
      <button type="button" className="space-switch" aria-haspopup="menu" aria-expanded={Boolean(menu)}
        title="Пространства" onMouseDown={(e) => menu && e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.left, y: r.bottom + 4 });
        }}>
        <span className="space-switch-text">
          <span className="space-switch-name">{title}</span>
          {subtitle && <span className="space-switch-user">{subtitle}</span>}
        </span>
        <ChevronIcon />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {creating && <NewSpaceDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** The «Пространство» tab of the settings of an own space: its name; spaces other than the main one can be deleted. */
export function SpaceSettings() {
  const { own } = useOpenSpace();
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [name, setName] = useState(own?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const sent = useRef(null);
  if (!own) return null;

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Enter saves, and so does leaving the field: the same name is sent once.
  const save = () => {
    const next = name.trim();
    if (!next) setName(own.name);
    else if (next !== own.name && next !== sent.current) {
      sent.current = next;
      run(() => renameSpace(own.id, next).catch((err) => {
        sent.current = null;
        throw err;
      }));
    }
  };

  function remove() {
    if (!confirm(`Удалить пространство «${own.name}» со всеми досками, карточками и чатами? `
      + 'Участники потеряют к нему доступ. Это нельзя отменить.')) return;
    run(() => deleteSpace(own.id));
  }

  return (
    <div className="manage space-settings">
      <label className="field manage-field">
        <span className="field-label">Название пространства</span>
        <input className="manage-input" value={name} maxLength={100} disabled={!online || busy}
          onChange={(e) => setName(e.target.value)} onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              save();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') setName(own.name);
          }} />
      </label>
      <p className="muted account-hint">
        Название видно вверху экрана вместо вашего имени и у участников, которым открыты доски пространства.
      </p>
      <ul className="fp-list ff-group space-switches">
        <SwitchRow label="Отметка «Выполнена» у карточек" on={own.doneMarks !== false} disabled={!online || busy}
          meta="Для досок без своей настройки"
          onChange={(on) => run(() => setSpaceDoneMarks(own.id, on))} />
      </ul>
      {!online && <p className="muted">Изменить пространство можно только при подключении к интернету.</p>}
      {own.main ? (
        <p className="muted account-hint">Это основное пространство, его нельзя удалить. Другие пространства создаются в меню названия вверху экрана.</p>
      ) : (
        <div className="manage-row account-row">
          <span className="account-email">Удалить пространство со всем содержимым</span>
          <button type="button" className="btn btn-small btn-danger" disabled={!online || busy} onClick={remove}>Удалить</button>
        </div>
      )}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState, inviteMember, leaveCurrentBoard, loadMembers, membersState, removeMember } from '../auth.js';
import { boardName, currentBoard, isOwnBoard } from '../board.js';
import { db } from '../db.js';
import { childrenOf, descendants, flattenFolders, folderPath, folderTree, liveFolders, topFolderIds } from '../folders.js';
import { folderIdsOf, peopleStore } from '../people.js';
import { syncStatus } from '../sync.js';
import Avatar from './Avatar.jsx';
import {
  BackIcon, DialogField, GroupRow, names, SEARCH_FROM, SearchField, SwitchRow,
} from './FolderFilter.jsx';
import FolderSelect from './FolderSelect.jsx';
import Modal from './Modal.jsx';

/** Folders of the own board can be shared: signed in and not on someone else's board. */
export function useCanShare() {
  const { status } = useSyncExternalStore(authState.subscribe, authState.get);
  return status === 'signedIn' && isOwnBoard;
}

function useMembers() {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const members = useSyncExternalStore(membersState.subscribe, membersState.get);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!online) return;
    loadMembers().catch((err) => setError(err.message));
  }, [online]);

  /** Resolves to false if the action failed (the error is shown). */
  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { online, members, error, busy, run };
}

const memberLabel = (m) => (m.name ? `${m.name} · ${m.email}` : m.email);

function MemberName({ member }) {
  return (
    <>
      <Avatar user={member} size={28} />
      <span className="account-email" title={member.email}>
        {memberLabel(member)}
        {!member.joined && <span className="muted"> — ещё не входил</span>}
      </span>
    </>
  );
}

const OFFLINE = <p className="muted">Для управления доступом нужен интернет.</p>;

/**
 * «Участники» in the settings of a folder of the own board: those invited to it directly, and those who
 * get it through a folder above (changed in that folder's settings). Access to a folder covers
 * everything in it, also what is added later.
 */
export function FolderMembers({ folder, folders }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const target = { folder: folder.id };
  const above = folderPath(folder, folders).slice(0, -1).reverse();
  const has = (m) => folderIdsOf(m).includes(folder.id);
  const direct = members?.filter(has) ?? [];
  const via = (m) => above.find((f) => folderIdsOf(m).includes(f.id));
  const viaAbove = members?.filter((m) => !has(m) && via(m)) ?? [];
  const others = members?.filter((m) => !has(m)) ?? [];
  const listId = `members-${folder.id}`;

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), target))) setEmail('');
  }

  async function remove(member) {
    if (!confirm(`Закрыть доступ к доске «${folder.name}» для ${member.email}?`)) return;
    await run(() => removeMember(member.email, target));
  }

  return (
    <div className="manage-sections">
      <h4 className="manage-heading">Участники</h4>
      {!online && OFFLINE}
      {online && members && direct.length + viaAbove.length === 0 && <p className="muted">Доску видите только вы.</p>}
      {online && direct.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <button className="btn btn-small" disabled={busy} onClick={() => remove(m)}>Убрать</button>
        </div>
      ))}
      {online && viaAbove.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <span className="muted member-via">через доску «{via(m).name}»</span>
        </div>
      ))}
      {online && (
        <form className="manage-add" onSubmit={invite}>
          <label className="field manage-field">
            <span className="field-label">Почта участника</span>
            <input className="manage-input" type="email" value={email} maxLength={254} autoComplete="off"
              list={listId} onChange={(e) => setEmail(e.target.value)} />
            <datalist id={listId}>
              {others.map((m) => <option key={m.email} value={m.email}>{m.name ?? ''}</option>)}
            </datalist>
          </label>
          <button type="submit" className="btn btn-small" disabled={busy || !email.trim()}>Пригласить</button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

/** The «Доступ» tab: who sees which folders of the own board; on someone else's board, leaving it. */
export default function SharingSection() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const folders = useLiveQuery(async () => liveFolders(await db.folders.toArray(), { standIn: false }), []);
  return currentBoard
    ? <SharedBoard board={user?.boards?.find((b) => b.id === currentBoard)} folders={folders} />
    : <OwnBoard folders={folders ?? []} />;
}

function SharedBoard({ board, folders }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const people = useSyncExternalStore(peopleStore.subscribe, peopleStore.get);
  const me = useSyncExternalStore(authState.subscribe, authState.get).user?.id;
  // The folders opened to the user (the top ones, the rest is inside them).
  const mine = folders && folderIdsOf(people.find((p) => p.id === me));
  const opened = folders && mine?.length ? topFolderIds(mine, folders).map((id) => folders.find((f) => f.id === id)) : [];

  async function leave() {
    if (!confirm('Покинуть это пространство? Вернуться можно будет, только если владелец пригласит вас снова.')) return;
    setBusy(true);
    setError(null);
    try {
      await leaveCurrentBoard();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <h4 className="manage-heading">Это пространство</h4>
      <div className="manage-row account-row">
        <span className="account-email">{board ? boardName(board) : 'Общее пространство'}</span>
        <button className="btn btn-small btn-danger" disabled={busy || !online} onClick={leave}>Покинуть</button>
      </div>
      <p className="muted account-hint">
        {opened.length ? `Вам открыты доски: ${opened.map((f) => `«${f.name}»`).join(', ')}. ` : ''}
        Вы можете менять карточки и вложенные доски в них; колонки настраивает владелец.
      </p>
      <p className="muted account-hint">Чтобы открыть доступ к своим доскам, переключитесь на своё пространство.</p>
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

/**
 * The folders opened to `member`, like the «Доски» filter: one level per screen, a switch per folder.
 * A folder opened through one above it is on and locked.
 */
function MemberFoldersDialog({ member, folders, busy, onSet, onClose }) {
  const tree = folderTree(folders);
  const own = new Set(folderIdsOf(member));
  const through = (folder) => folderPath(folder, folders).slice(0, -1).reverse().find((f) => own.has(f.id));
  const [currentId, setCurrentId] = useState(null);
  const current = currentId ? tree.byId.get(currentId) ?? null : null;
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const open = (id) => {
    setQuery('');
    setCurrentId(id);
  };

  const list = needle
    ? flattenFolders(folders).map(({ folder }) => folder).filter((f) => f.name.toLowerCase().includes(needle))
    : childrenOf(folders, currentId);
  const row = (f) => {
    const via = through(f);
    const where = needle && folderPath(f, folders).slice(0, -1).map((p) => p.name).join(' › ');
    const inside = !via && !own.has(f.id)
      && descendants(folders, f.id).filter((d) => own.has(d.id) && !through(d));
    const meta = [where, via && `через «${via.name}»`, inside?.length && `внутри открыты: ${names(inside)}`]
      .filter(Boolean).join(' · ') || null;
    const props = {
      label: f.name, meta, on: own.has(f.id) || Boolean(via), disabled: busy || Boolean(via),
      onChange: (on) => onSet(f, on),
    };
    return childrenOf(folders, f.id).length
      ? <GroupRow key={f.id} {...props} switchLabel={`Доступ к «${f.name}»`} onOpen={() => open(f.id)} />
      : <SwitchRow key={f.id} {...props} />;
  };
  const parent = current ? tree.byId.get(tree.parentOf(current)) : null;

  return (
    <Modal title={current ? current.name : member.name || member.email} onClose={onClose}
      className="folder-picker folder-filter-sheet" closeButton>
      {current ? (
        <button type="button" className="ff-back" onClick={() => open(parent?.id ?? null)}>
          <BackIcon />
          <span>{parent ? parent.name : 'Все доски'}</span>
        </button>
      ) : (
        <p className="fp-hint">Доступ к доске открывает всё, что на ней, в том числе вложенные доски, которые появятся позже.</p>
      )}
      {!current && folders.length >= SEARCH_FROM && (
        <SearchField placeholder="Поиск доски" value={query} onChange={setQuery} />
      )}
      <ul className="fp-list ff-list">
        {list.map(row)}
        {list.length === 0 && <li className="fp-empty">{needle ? 'Ничего не найдено' : 'Вложенных досок нет'}</li>}
      </ul>
      <div className="actions fp-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>Готово</button>
      </div>
    </Modal>
  );
}

/** The field with the folders opened to `member`; opens MemberFoldersDialog. */
function MemberFolders({ member, folders, busy, onSet }) {
  const top = topFolderIds(folderIdsOf(member), folders).map((id) => folders.find((f) => f.id === id)).filter(Boolean);
  return (
    <DialogField label="Доступ к доскам" value={top.length ? names(top) : 'Нет'}
      dialog={(onClose) => (
        <MemberFoldersDialog member={member} folders={folders} busy={busy} onSet={onSet} onClose={onClose} />
      )} />
  );
}

function OwnBoard({ folders }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState('');
  const choice = folders.some((f) => f.id === picked) ? picked : folders[0]?.id ?? '';

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), { folder: choice }))) setEmail('');
  }

  function toggle(member, folder, on) {
    run(() => (on ? inviteMember(member.email, { folder: folder.id }) : removeMember(member.email, { folder: folder.id })));
  }

  async function removeAll(member) {
    if (!confirm(`Закрыть ${member.email} доступ ко всем вашим доскам?`)) return;
    await run(() => removeMember(member.email));
  }

  return (
    <>
      <h4 className="manage-heading">Доступ к моим доскам</h4>
      <p className="muted account-hint">
        Участник видит только отмеченные доски вместе со всем, что на них, в том числе с вложенными досками,
        которые появятся позже, и может менять в них карточки и вложенные доски; сами колонки меняете только вы.
        Пусть войдёт через Google или Яндекс с этим адресом почты — ваше пространство появится у него в списке вверху
        экрана. Участников также видно в настройках доски.
      </p>
      {!online && OFFLINE}
      {online && members?.map((m) => (
          <div key={m.email} className="member">
            <div className="manage-row account-row">
              <MemberName member={m} />
              <button className="btn btn-small" disabled={busy} onClick={() => removeAll(m)}>Убрать</button>
            </div>
            <MemberFolders member={m} folders={folders} busy={busy} onSet={(folder, on) => toggle(m, folder, on)} />
          </div>
      ))}
      {online && folders.length > 0 && (
        <form className="manage-add member-invite" onSubmit={invite}>
          <label className="field manage-field">
            <span className="field-label">Почта участника</span>
            <input className="manage-input" type="email" value={email} maxLength={254} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <FolderSelect label="Доступ к" className="manage-field" folders={folders} value={choice} onChange={setPicked} />
          <button type="submit" className="btn btn-small" disabled={busy || !email.trim()}>Пригласить</button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

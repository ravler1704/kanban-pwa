import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState, inviteMember, leaveCurrentBoard, loadMembers, membersState, removeMember } from '../auth.js';
import { boardName, currentBoard, isOwnBoard } from '../board.js';
import { db } from '../db.js';
import { flattenFolders, folderPath, liveFolders, topFolderIds } from '../folders.js';
import { folderIdsOf, peopleStore } from '../people.js';
import { syncStatus } from '../sync.js';
import FolderSelect from './FolderSelect.jsx';

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
    <span className="account-email" title={member.email}>
      {memberLabel(member)}
      {!member.joined && <span className="muted"> — ещё не входил</span>}
    </span>
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
    if (!confirm(`Закрыть доступ к папке «${folder.name}» для ${member.email}?`)) return;
    await run(() => removeMember(member.email, target));
  }

  return (
    <div className="manage-sections">
      <h4 className="manage-heading">Участники</h4>
      {!online && OFFLINE}
      {online && members && direct.length + viaAbove.length === 0 && <p className="muted">Папку видите только вы.</p>}
      {online && direct.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <button className="btn btn-small" disabled={busy} onClick={() => remove(m)}>Убрать</button>
        </div>
      ))}
      {online && viaAbove.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <span className="muted member-via">через папку «{via(m).name}»</span>
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
    if (!confirm('Покинуть эту доску? Вернуться можно будет, только если владелец пригласит вас снова.')) return;
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
      <h4 className="manage-heading">Эта доска</h4>
      <div className="manage-row account-row">
        <span className="account-email">{board ? boardName(board) : 'Общая доска'}</span>
        <button className="btn btn-small btn-danger" disabled={busy || !online} onClick={leave}>Покинуть</button>
      </div>
      <p className="muted account-hint">
        {opened.length ? `Вам открыты папки: ${opened.map((f) => `«${f.name}»`).join(', ')}. ` : ''}
        Вы можете менять карточки и вложенные папки в них; колонки настраивает владелец.
      </p>
      <p className="muted account-hint">Чтобы открыть доступ к своим папкам, переключитесь на свою доску.</p>
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

function OwnBoard({ folders }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState('');
  const rows = flattenFolders(folders);
  const choice = folders.some((f) => f.id === picked) ? picked : folders[0]?.id ?? '';

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), { folder: choice }))) setEmail('');
  }

  function toggle(member, folder, on) {
    run(() => (on ? inviteMember(member.email, { folder: folder.id }) : removeMember(member.email, { folder: folder.id })));
  }

  async function removeAll(member) {
    if (!confirm(`Закрыть ${member.email} доступ ко всем вашим папкам?`)) return;
    await run(() => removeMember(member.email));
  }

  return (
    <>
      <h4 className="manage-heading">Доступ к моим папкам</h4>
      <p className="muted account-hint">
        Участник видит только отмеченные папки вместе со всем, что в них, в том числе с вложенными папками,
        которые появятся позже, и может менять в них карточки и вложенные папки; сами колонки меняете только вы.
        Пусть войдёт через Google или Яндекс с этим адресом почты — ваша доска появится у него в списке вверху
        экрана. Участников также видно в настройках папки.
      </p>
      {!online && OFFLINE}
      {online && members?.map((m) => {
        const own = new Set(folderIdsOf(m));
        // The folder above that gives access to this one, if any.
        const through = (folder) => folderPath(folder, folders).slice(0, -1).reverse().find((f) => own.has(f.id));
        return (
          <div key={m.email} className="member">
            <div className="manage-row account-row">
              <MemberName member={m} />
              <button className="btn btn-small" disabled={busy} onClick={() => removeAll(m)}>Убрать</button>
            </div>
            <div className="member-projects">
              {rows.map(({ folder, depth }) => {
                const via = through(folder);
                return (
                  <label key={folder.id} className="member-project" style={{ paddingLeft: `${depth * 18}px` }}
                    title={via ? `Открыта через папку «${via.name}»` : undefined}>
                    <input type="checkbox" checked={own.has(folder.id) || Boolean(via)} disabled={busy || Boolean(via)}
                      onChange={(e) => toggle(m, folder, e.target.checked)} />
                    {folder.name}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
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

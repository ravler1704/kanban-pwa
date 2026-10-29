import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState, inviteMember, leaveCurrentBoard, loadMembers, membersState, removeMember } from '../auth.js';
import { boardName, currentBoard } from '../board.js';
import { db } from '../db.js';
import { syncStatus } from '../sync.js';

/** Projects of the own board can be shared: signed in and not on someone else's board. */
export function useCanShare() {
  const { status } = useSyncExternalStore(authState.subscribe, authState.get);
  return status === 'signedIn' && !currentBoard;
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

/** «Участники» in the settings of a project of the own board. */
export function ProjectMembers({ project }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const inProject = members?.filter((m) => m.projects.includes(project.id)) ?? [];
  const others = members?.filter((m) => !m.projects.includes(project.id)) ?? [];
  const listId = `members-${project.id}`;

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), project.id))) setEmail('');
  }

  async function remove(member) {
    if (!confirm(`Закрыть доступ к проекту «${project.name}» для ${member.email}?`)) return;
    await run(() => removeMember(member.email, project.id));
  }

  return (
    <div className="manage-sections">
      <h4 className="manage-heading">Участники</h4>
      {!online && OFFLINE}
      {online && members && inProject.length === 0 && <p className="muted">Проект видите только вы.</p>}
      {online && inProject.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <button className="btn btn-small" disabled={busy} onClick={() => remove(m)}>Убрать</button>
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

/** The «Доступ» tab: who sees which projects of the own board; on someone else's board, leaving it. */
export default function SharingSection() {
  const { user } = useSyncExternalStore(authState.subscribe, authState.get);
  const projects = useLiveQuery(
    async () => (await db.projects.toArray()).filter((p) => !p.deleted).sort((a, b) => a.position - b.position),
    [],
  );
  return currentBoard
    ? <SharedBoard board={user?.boards?.find((b) => b.id === currentBoard)} projects={projects} />
    : <OwnBoard projects={projects ?? []} />;
}

function SharedBoard({ board, projects }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);

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
        {projects?.length
          ? `Вам открыты проекты: ${projects.map((p) => `«${p.name}»`).join(', ')}. `
          : ''}
        Вы можете менять карточки и разделы этих проектов; сами проекты и колонки настраивает владелец.
      </p>
      <p className="muted account-hint">Чтобы открыть доступ к своим проектам, переключитесь на свою доску.</p>
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

function OwnBoard({ projects }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), project.id))) setEmail('');
  }

  function toggle(member, p, on) {
    run(() => (on ? inviteMember(member.email, p.id) : removeMember(member.email, p.id)));
  }

  async function removeAll(member) {
    if (!confirm(`Закрыть ${member.email} доступ ко всем вашим проектам?`)) return;
    await run(() => removeMember(member.email));
  }

  return (
    <>
      <h4 className="manage-heading">Доступ к моим проектам</h4>
      <p className="muted account-hint">
        Участник видит только отмеченные проекты и может менять в них карточки и разделы; сами проекты
        и колонки меняете только вы. Пусть войдёт через Google или Яндекс с этим адресом почты — ваша доска
        появится у него в списке вверху экрана. Участников проекта также видно в настройках доски.
      </p>
      {!online && OFFLINE}
      {online && members?.map((m) => (
        <div key={m.email} className="member">
          <div className="manage-row account-row">
            <MemberName member={m} />
            <button className="btn btn-small" disabled={busy} onClick={() => removeAll(m)}>Убрать</button>
          </div>
          <div className="member-projects">
            {projects.map((p) => (
              <label key={p.id} className="member-project">
                <input type="checkbox" checked={m.projects.includes(p.id)} disabled={busy}
                  onChange={(e) => toggle(m, p, e.target.checked)} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      {online && projects.length === 0 && <p className="muted">Сначала создайте проект — доступ выдаётся к проектам.</p>}
      {online && projects.length > 0 && (
        <form className="manage-add member-invite" onSubmit={invite}>
          <label className="field manage-field">
            <span className="field-label">Почта участника</span>
            <input className="manage-input" type="email" value={email} maxLength={254} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field manage-field">
            <span className="field-label">Проект</span>
            <select className="select" value={project.id} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-small" disabled={busy || !email.trim()}>Пригласить</button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

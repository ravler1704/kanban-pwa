import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { authState, inviteMember, leaveCurrentBoard, loadMembers, membersState, removeMember } from '../auth.js';
import { boardName, currentBoard, isOwnBoard } from '../board.js';
import { db, DEFAULT_SPACE_ID } from '../db.js';
import { liveSpaces, spaceIdOf } from '../spaces.js';
import { syncStatus } from '../sync.js';

/** Projects of the own board can be shared: signed in and not on someone else's board. */
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

/** «Участники» in the settings of a project of the own board. */
export function ProjectMembers({ project }) {
  const spaceId = project.spaceId ?? DEFAULT_SPACE_ID;
  const space = useLiveQuery(() => db.spaces.get(spaceId), [spaceId]);
  return (
    <Members target={{ project: project.id }} spaceId={spaceId}
      spaceName={space?.name ?? 'Личное'} what={`к проекту «${project.name}»`} alone="Проект видите только вы." />
  );
}

/** «Участники» of a space of the own board: they get every project in it, also later ones. */
export function SpaceMembers({ space }) {
  return (
    <Members target={{ space: space.id }} what={`ко всему пространству «${space.name}»`}
      alone="Доступа ко всему пространству ни у кого нет." />
  );
}

/**
 * Invited to `target` ({ project } or { space }); for a project also those who get it through
 * its space (`spaceId`), who are changed in the space's settings.
 */
function Members({ target, spaceId, spaceName, what, alone }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  const has = (m) => (target.space ? m.spaces.includes(target.space) : m.projects.includes(target.project));
  const direct = members?.filter(has) ?? [];
  const viaSpace = spaceId ? members?.filter((m) => !has(m) && m.spaces.includes(spaceId)) ?? [] : [];
  const others = members?.filter((m) => !has(m)) ?? [];
  const listId = `members-${target.space ?? target.project}`;

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), target))) setEmail('');
  }

  async function remove(member) {
    if (!confirm(`Закрыть доступ ${what} для ${member.email}?`)) return;
    await run(() => removeMember(member.email, target));
  }

  return (
    <div className="manage-sections">
      <h4 className="manage-heading">Участники</h4>
      {!online && OFFLINE}
      {online && members && direct.length + viaSpace.length === 0 && <p className="muted">{alone}</p>}
      {online && direct.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <button className="btn btn-small" disabled={busy} onClick={() => remove(m)}>Убрать</button>
        </div>
      ))}
      {online && viaSpace.map((m) => (
        <div key={m.email} className="manage-row account-row">
          <MemberName member={m} />
          <span className="muted member-via">через пространство «{spaceName}»</span>
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
  const data = useLiveQuery(async () => ({
    projects: (await db.projects.toArray()).filter((p) => !p.deleted).sort((a, b) => a.position - b.position),
    spaces: liveSpaces(await db.spaces.toArray()),
  }), []);
  return currentBoard
    ? <SharedBoard board={user?.boards?.find((b) => b.id === currentBoard)} projects={data?.projects} />
    : <OwnBoard projects={data?.projects ?? []} spaces={data?.spaces ?? []} />;
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

function OwnBoard({ projects, spaces }) {
  const { online, members, error, busy, run } = useMembers();
  const [email, setEmail] = useState('');
  // 'space:<id>' or 'project:<id>'.
  const [picked, setPicked] = useState('');
  const groups = spaces.map((s) => ({ space: s, projects: projects.filter((p) => spaceIdOf(p, spaces) === s.id) }));
  const choices = [...projects.map((p) => `project:${p.id}`), ...spaces.map((s) => `space:${s.id}`)];
  const choice = choices.includes(picked) ? picked : choices[0];
  const targetOf = (key) => {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return { [kind]: id };
  };

  async function invite(e) {
    e.preventDefault();
    if (await run(() => inviteMember(email.trim(), targetOf(choice)))) setEmail('');
  }

  function toggle(member, target, on) {
    run(() => (on ? inviteMember(member.email, target) : removeMember(member.email, target)));
  }

  async function removeAll(member) {
    if (!confirm(`Закрыть ${member.email} доступ ко всем вашим проектам и пространствам?`)) return;
    await run(() => removeMember(member.email));
  }

  return (
    <>
      <h4 className="manage-heading">Доступ к моим проектам</h4>
      <p className="muted account-hint">
        Участник видит только отмеченные проекты и может менять в них карточки и разделы; сами проекты
        и колонки меняете только вы. «Всё пространство» открывает все его проекты, в том числе те, что
        появятся в нём позже. Пусть войдёт через Google или Яндекс с этим адресом почты — ваша доска
        появится у него в списке вверху экрана. Участников также видно в настройках доски.
      </p>
      {!online && OFFLINE}
      {online && members?.map((m) => (
        <div key={m.email} className="member">
          <div className="manage-row account-row">
            <MemberName member={m} />
            <button className="btn btn-small" disabled={busy} onClick={() => removeAll(m)}>Убрать</button>
          </div>
          {groups.map(({ space, projects: own }) => {
            const whole = m.spaces.includes(space.id);
            return (
              <div key={space.id} className="member-space">
                {spaces.length > 1 || whole ? (
                  <label className="member-project member-space-name">
                    <input type="checkbox" checked={whole} disabled={busy}
                      onChange={(e) => toggle(m, { space: space.id }, e.target.checked)} />
                    Всё пространство «{space.name}»
                  </label>
                ) : null}
                <div className="member-projects">
                  {own.map((p) => (
                    <label key={p.id} className="member-project" title={whole ? 'Открыт через пространство' : undefined}>
                      <input type="checkbox" checked={whole || m.projects.includes(p.id)} disabled={busy || whole}
                        onChange={(e) => toggle(m, { project: p.id }, e.target.checked)} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {online && choices.length > 0 && (
        <form className="manage-add member-invite" onSubmit={invite}>
          <label className="field manage-field">
            <span className="field-label">Почта участника</span>
            <input className="manage-input" type="email" value={email} maxLength={254} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field manage-field">
            <span className="field-label">Доступ к</span>
            <select className="select" value={choice} onChange={(e) => setPicked(e.target.value)}>
              {projects.length > 0 && (
                <optgroup label="Проект">
                  {projects.map((p) => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Всё пространство">
                {spaces.map((s) => <option key={s.id} value={`space:${s.id}`}>{s.name}</option>)}
              </optgroup>
            </select>
          </label>
          <button type="submit" className="btn btn-small" disabled={busy || !email.trim()}>Пригласить</button>
        </form>
      )}
      {error && <p className="login-error">{error}</p>}
    </>
  );
}

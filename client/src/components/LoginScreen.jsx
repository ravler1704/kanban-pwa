import { useEffect, useState, useSyncExternalStore } from 'react';
import { signInAsTestUser, signInWithEmail, signInWithGoogle } from '../auth.js';
import { peekPendingTemplate } from '../pendingTemplate.js';
import { getTemplate } from '../templatesApi.js';
import { INSTALL_PAGE, installStore } from '../install.js';
import { syncStatus } from '../sync.js';
import { EmailCodeForm, GoogleButton, YandexButton } from './ProviderButtons.jsx';

export default function LoginScreen({ clientId, yandexClientId, devLogin, emailLogin, notice }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const { installed } = useSyncExternalStore(installStore.subscribe, installStore.get);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingBoard, setPendingBoard] = useState(null);

  useEffect(() => {
    const id = peekPendingTemplate();
    if (!id) return;
    let cancel = false;
    getTemplate(id)
      .then((t) => { if (!cancel) setPendingBoard(t.title); })
      .catch(() => { if (!cancel) setPendingBoard(null); });
    return () => { cancel = true; };
  }, []);

  async function run(signIn) {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shownError = error ?? notice;
  return (
    <div className="login">
      <div className="login-card">
        <h1>Канбан</h1>
        {online ? (
          <>
            <p className="muted">
              {pendingBoard
                ? `Войдите — после входа создадим доску «${pendingBoard}» в вашем пространстве.`
                : 'Войдите, чтобы открыть своё пространство.'}
            </p>
            {clientId && (
              <GoogleButton clientId={clientId} onError={setError}
                onCredential={(credential) => run(() => signInWithGoogle(credential))} />
            )}
            {yandexClientId && <YandexButton disabled={busy}>Войти с Яндекс ID</YandexButton>}
            {emailLogin && (
              <>
                {(clientId || yandexClientId) && <span className="login-or">или по почте</span>}
                <EmailCodeForm submitLabel="Войти" onCode={signInWithEmail} />
              </>
            )}
            {devLogin && (
              <button type="button" className="btn login-dev" disabled={busy} onClick={() => run(signInAsTestUser)}>
                Войти в тестовый аккаунт
              </button>
            )}
            {busy && <p className="muted">Вход…</p>}
          </>
        ) : (
          <p className="muted">Для входа нужен интернет.</p>
        )}
        {shownError && <p className="login-error">{shownError}</p>}
        {!installed && (
          <a className="login-install muted" href={INSTALL_PAGE}>Установить приложение — Android, iPhone, компьютер</a>
        )}
      </div>
    </div>
  );
}

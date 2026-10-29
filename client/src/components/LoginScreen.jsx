import { useState, useSyncExternalStore } from 'react';
import { signInAsTestUser, signInWithEmail, signInWithGoogle } from '../auth.js';
import { syncStatus } from '../sync.js';
import { EmailCodeForm, GoogleButton, YandexButton } from './ProviderButtons.jsx';

export default function LoginScreen({ clientId, yandexClientId, devLogin, emailLogin, notice }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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
            <p className="muted">Войдите, чтобы открыть доску.</p>
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
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { signInAsTestUser, signInWithGoogle } from '../auth.js';
import { syncStatus } from '../sync.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let gisPromise = null;
function loadGoogleIdentity() {
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('Не удалось загрузить вход через Google.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export default function LoginScreen({ clientId, devLogin }) {
  const { online } = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const button = useRef(null);
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

  useEffect(() => {
    if (!online || !clientId) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !button.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => run(() => signInWithGoogle(credential)),
        });
        google.accounts.id.renderButton(button.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'ru',
          width: 280,
        });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [online, clientId]);

  return (
    <div className="login">
      <div className="login-card">
        <h1>Канбан</h1>
        {online ? (
          <>
            <p className="muted">Войдите, чтобы открыть доску.</p>
            <div ref={button} className="login-button" aria-busy={busy} />
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
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}

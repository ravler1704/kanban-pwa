import { useEffect, useRef, useState } from 'react';
import { startYandexAuth } from '../auth.js';

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

/** Google's own button; `onCredential` receives the ID token. */
export function GoogleButton({ clientId, onCredential, onError, text = 'signin_with' }) {
  const container = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (cancelled || !container.current) return;
        // GIS keeps one global callback, so the button rendered last receives the credential.
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => handlers.current.onCredential(credential),
        });
        google.accounts.id.renderButton(container.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text,
          locale: 'ru',
          width: 280,
        });
        setReady(true);
      })
      .catch((err) => !cancelled && handlers.current.onError?.(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  return <div ref={container} className="login-button" aria-busy={!ready} />;
}

export function YandexButton({ link = false, disabled, children }) {
  return (
    <button type="button" className="btn btn-provider" disabled={disabled} onClick={() => startYandexAuth({ link })}>
      <span className="ya-logo" aria-hidden="true">Я</span>
      <span>{children}</span>
    </button>
  );
}

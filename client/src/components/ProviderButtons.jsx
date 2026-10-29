import { useEffect, useRef, useState } from 'react';
import { requestEmailCode, startYandexAuth } from '../auth.js';

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

/**
 * Address, then the 4-digit code mailed to it. `onCode(email, code)` signs in or links the address;
 * it may resolve to false (the user declined), which also resets the form.
 */
export function EmailCodeForm({ link = false, submitLabel, onCode }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [wait, setWait] = useState(0);
  const codeInput = useRef(null);

  // The field is disabled while a code is checked; a wrong one is typed again right away.
  useEffect(() => {
    if (step === 'code' && !busy) codeInput.current?.focus();
  }, [step, busy]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function act(action) {
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

  const send = () => act(async () => {
    setWait(await requestEmailCode(email.trim(), { link }));
    setCode('');
    setStep('code');
  });

  const confirm = (value) => act(async () => {
    try {
      await onCode(email.trim(), value);
    } catch (err) {
      setCode('');
      throw err;
    }
    setStep('email');
    setEmail('');
    setCode('');
  });

  if (step === 'email') {
    return (
      <form className="email-login" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label className="field">
          <span className="field-label">Почта</span>
          <input className="email-input" type="email" value={email} maxLength={254} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={busy || !email.trim()}>Получить код</button>
        {error && <p className="login-error">{error}</p>}
      </form>
    );
  }

  return (
    <form className="email-login" onSubmit={(e) => { e.preventDefault(); confirm(code); }}>
      <p className="muted">Код отправлен на {email.trim()}. Письмо может прийти через минуту, проверьте и «Спам».</p>
      <label className="field">
        <span className="field-label">Код из письма</span>
        <input className="email-input email-code" value={code} inputMode="numeric" autoComplete="one-time-code"
          maxLength={4} ref={codeInput} disabled={busy}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, '').slice(0, 4);
            setCode(value);
            if (value.length === 4) confirm(value);
          }} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 4}>{submitLabel}</button>
      <div className="email-login-links">
        <button type="button" className="btn-link" disabled={busy || wait > 0} onClick={send}>
          {wait > 0 ? `Отправить ещё раз через ${wait} с` : 'Отправить ещё раз'}
        </button>
        <button type="button" className="btn-link" disabled={busy}
          onClick={() => { setStep('email'); setError(null); }}>Другой адрес</button>
      </div>
      {error && <p className="login-error">{error}</p>}
    </form>
  );
}

export function YandexButton({ link = false, disabled, children }) {
  return (
    <button type="button" className="btn btn-provider" disabled={disabled} onClick={() => startYandexAuth({ link })}>
      <span className="ya-logo" aria-hidden="true">Я</span>
      <span>{children}</span>
    </button>
  );
}

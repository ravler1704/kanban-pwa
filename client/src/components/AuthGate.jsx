import { useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import { publicToken } from '../board.js';
import { usePublicLink } from '../public.js';
import LoginScreen from './LoginScreen.jsx';

/**
 * Shows the board unless the server said we are signed out. Before the first check
 * (e.g. opened offline) the board is shown with whatever is stored on the device.
 * A public link needs no sign-in.
 */
export default function AuthGate({ children }) {
  return publicToken ? <PublicGate>{children}</PublicGate> : <SignInGate>{children}</SignInGate>;
}

function SignInGate({ children }) {
  const auth = useSyncExternalStore(authState.subscribe, authState.get);
  if (auth.status === 'signedOut') {
    return (
      <LoginScreen clientId={auth.clientId} yandexClientId={auth.yandexClientId}
        devLogin={auth.devLogin} emailLogin={auth.emailLogin} notice={auth.notice} />
    );
  }
  return children;
}

function PublicGate({ children }) {
  const { status } = usePublicLink();
  if (status !== 'gone') return children;
  return (
    <div className="login">
      <div className="login-card">
        <h1>Канбан</h1>
        <p className="muted">Ссылка больше не действует: владелец закрыл доступ к проекту.</p>
        <a className="btn" href="/">Открыть своё пространство</a>
      </div>
    </div>
  );
}

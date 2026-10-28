import { useSyncExternalStore } from 'react';
import { authState } from '../auth.js';
import LoginScreen from './LoginScreen.jsx';

/**
 * Shows the board unless the server said we are signed out. Before the first check
 * (e.g. opened offline) the board is shown with whatever is stored on the device.
 */
export default function AuthGate({ children }) {
  const auth = useSyncExternalStore(authState.subscribe, authState.get);
  if (auth.status === 'signedOut') return <LoginScreen clientId={auth.clientId} devLogin={auth.devLogin} />;
  return children;
}

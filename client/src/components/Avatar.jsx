import { useState } from 'react';

/**
 * The account photo from Google / Yandex; the first letter of the name when there is none
 * or it does not load (e.g. offline: the photo is not cached).
 */
export default function Avatar({ user, size = 28 }) {
  const [failed, setFailed] = useState(null);
  const label = user?.name || user?.email || '';
  const style = { width: size, height: size };

  if (user?.picture && failed !== user.picture) {
    return (
      // Google serves photos only without a Referer from other sites.
      <img className="avatar" src={user.picture} alt="" style={style} referrerPolicy="no-referrer"
        onError={() => setFailed(user.picture)} />
    );
  }
  return (
    <span className="avatar avatar-letter" style={{ ...style, fontSize: size * 0.45 }} aria-hidden="true">
      {label.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

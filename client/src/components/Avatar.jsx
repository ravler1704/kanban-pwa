import { useState } from 'react';

/**
 * The account photo from Google / Yandex; the first letter of the name when there is none
 * or it does not load (e.g. offline: the photo is not cached), and until it has loaded.
 */
export default function Avatar({ user, size = 28 }) {
  const [loaded, setLoaded] = useState(null);
  const label = user?.name || user?.email || '';
  const style = { width: size, height: size };
  const picture = user?.picture;

  if (picture && loaded === picture) {
    // Google serves photos only without a Referer from other sites.
    return <img className="avatar" src={picture} alt="" style={style} referrerPolicy="no-referrer" />;
  }
  // Each person gets their own color, so letters of different people tell apart.
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return (
    <>
      <span className="avatar avatar-letter" aria-hidden="true"
        style={{ ...style, fontSize: size * 0.45, background: label ? `hsl(${hash} 55% 55%)` : undefined }}>
        {label.trim().charAt(0).toUpperCase() || '?'}
      </span>
      {picture && (
        <img src={picture} alt="" hidden referrerPolicy="no-referrer" onLoad={() => setLoaded(picture)} />
      )}
    </>
  );
}

import { useCallback, useState } from 'react';

/** Hover class for cards: some Chromium builds (incl. Yandex) miss :hover on draggable nodes. */
export function usePointerHover() {
  const [hovered, setHovered] = useState(false);
  const onPointerEnter = useCallback((e) => {
    if (e.pointerType !== 'touch') setHovered(true);
  }, []);
  const onPointerLeave = useCallback(() => setHovered(false), []);
  return { hovered, onPointerEnter, onPointerLeave };
}

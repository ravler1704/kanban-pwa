import { changeFolderColumnSet, createColumnSetFromTemplate } from './actions.js';

/** Create a column set from a server template payload; optionally assign it to `folderId`. */
export async function applyBoardTemplate(payload, {
  setName, folderId = null, applyBoardOptions = false,
} = {}) {
  const name = (setName ?? payload.setName ?? 'Шаблон').trim().slice(0, 100);
  const setId = await createColumnSetFromTemplate(name, payload);
  if (folderId) {
    await changeFolderColumnSet(folderId, setId, {});
    if (applyBoardOptions) {
      const { setFolderBackground, setFolderDoneMarks } = await import('./actions.js');
      if (payload.background != null) await setFolderBackground(folderId, payload.background);
      if (payload.doneMarks != null) await setFolderDoneMarks(folderId, payload.doneMarks);
    }
  }
  return setId;
}

export function payloadFromSet(setName, columns, { doneMarks = null, background = null } = {}) {
  return {
    setName: setName.trim().slice(0, 100),
    columns: columns.map((c) => ({
      name: c.name,
      addToTop: !!c.addToTop,
      wipLimit: c.wipLimit ?? null,
      color: c.color ?? null,
    })),
    doneMarks,
    background,
  };
}

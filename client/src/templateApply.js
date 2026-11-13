import {
  changeFolderColumnSet, createColumnSetFromTemplate, createFolder,
  setFolderBackground, setFolderDoneMarks,
} from './actions.js';

async function applyTemplateBoardOptions(folderId, payload) {
  if (payload.background != null) await setFolderBackground(folderId, payload.background);
  if (payload.doneMarks != null) await setFolderDoneMarks(folderId, payload.doneMarks);
}

/** Create a column set from a server template payload; optionally assign it to `folderId`. */
export async function applyBoardTemplate(payload, {
  setName, folderId = null, applyBoardOptions = false,
} = {}) {
  const name = (setName ?? payload.setName ?? 'Шаблон').trim().slice(0, 100);
  const setId = await createColumnSetFromTemplate(name, payload);
  if (folderId) {
    await changeFolderColumnSet(folderId, setId, {});
    if (applyBoardOptions) await applyTemplateBoardOptions(folderId, payload);
  }
  return setId;
}

/** New top-level board (folder) with columns and options from a template. */
export async function createBoardFromTemplate(payload, { boardName, parentId = null } = {}) {
  const name = (boardName ?? payload.setName ?? 'Новая доска').trim().slice(0, 100);
  const setId = await createColumnSetFromTemplate(name, payload);
  const folderId = await createFolder(name, { parentId, columnSetId: setId });
  await applyTemplateBoardOptions(folderId, payload);
  return { folderId, setId };
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

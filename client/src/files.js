import { boardHeaders, boardQuery } from './board.js';
import { requestSync } from './sync.js';

// Files attached to cards live on the server only; the card lists them (card.attachments)
// and the server changes that list, so attaching needs a connection and a synced card.

/** Address of the file; `download` saves it instead of opening. */
export function fileUrl(file, { download = false } = {}) {
  const query = boardQuery();
  const extra = download ? `${query ? '&' : '?'}download` : '';
  return `/api/files/${file.id}${query}${extra}`;
}

export const isImage = (file) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type);
export const isVideo = (file) => /^video\/(mp4|webm|ogg|quicktime)$/.test(file.type);

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

// ---- uploads in progress: they outlive the card editor, so the board and a reopened card show them ----

let uploads = [];
const listeners = new Set();

function setUploads(next) {
  uploads = next;
  for (const l of listeners) l();
}

/** [{ key, cardId, name, progress (0…1), error }] */
export const uploadStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => uploads,
};

const update = (key, patch) => setUploads(uploads.map((u) => (u.key === key ? { ...u, ...patch } : u)));

/** Starts uploading the files to the card in the background. */
export function attachFiles(cardId, files) {
  for (const file of files) {
    const key = `${cardId}:${file.name}:${file.size}:${Math.random()}`;
    setUploads([...uploads, { key, cardId, name: file.name, progress: 0, error: null }]);
    uploadFile(cardId, file, (progress) => update(key, { progress }))
      .then(() => setUploads(uploads.filter((u) => u.key !== key)))
      .catch((err) => update(key, { error: err.message }));
  }
}

/** Removes a failed upload from the list. */
export function dismissUpload(key) {
  setUploads(uploads.filter((u) => u.key !== key));
}

// Closing the page would cut uploads off.
window.addEventListener('beforeunload', (e) => {
  if (uploads.some((u) => !u.error)) e.preventDefault();
});

const ERRORS = {
  403: 'Здесь можно только смотреть.',
  404: 'Карточка ещё не на сервере или удалена.',
  507: 'На сервере закончилось место.',
};

/** Uploads one file to the card; `onProgress` gets 0…1. */
function uploadFile(cardId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ name: file.name, type: file.type || 'application/octet-stream' });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/cards/${encodeURIComponent(cardId)}/files?${params}`);
    for (const [key, value] of Object.entries(boardHeaders())) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        requestSync();
        resolve();
      } else {
        reject(new Error(ERRORS[xhr.status] ?? `Не удалось загрузить «${file.name}» (ошибка ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error(`Не удалось загрузить «${file.name}»: нет связи с сервером.`));
    xhr.send(file);
  });
}

// ---- board backgrounds uploaded by users (a folder's `background` is `file-<id>`) ----

const BACKGROUND_PREFIX = 'file-';
// Larger pictures are shrunk to this many pixels along the long side before the upload.
const BACKGROUND_MAX_SIDE = 2560;

export const isUploadedBackground = (background) => typeof background === 'string' && background.startsWith(BACKGROUND_PREFIX);

export const backgroundUrl = (background) => `/api/backgrounds/${background.slice(BACKGROUND_PREFIX.length)}${boardQuery()}`;

/** Shrinks the picture, uploads it as JPEG and gives the folder's `background` for it. */
export async function uploadBackground(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Это не картинка или её формат не поддерживается.');
  }
  const scale = Math.min(1, BACKGROUND_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const res = await fetch('/api/backgrounds', {
    method: 'POST',
    headers: { ...boardHeaders(), 'Content-Type': 'image/jpeg' },
    body: blob,
  }).catch(() => null);
  if (!res) throw new Error('Картинку можно загрузить только при связи с сервером.');
  if (!res.ok) {
    throw new Error({ 403: ERRORS[403], 413: 'Картинка слишком большая.', 507: ERRORS[507] }[res.status]
      ?? `Не удалось загрузить картинку (ошибка ${res.status}).`);
  }
  return (await res.json()).background;
}

export async function removeFile(cardId, fileId) {
  const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}/files/${fileId}/delete`, {
    method: 'POST',
    headers: boardHeaders(),
  }).catch(() => null);
  if (!res?.ok) throw new Error(res ? ERRORS[res.status] ?? 'Не удалось удалить файл.' : 'Нет связи с сервером.');
  requestSync();
}

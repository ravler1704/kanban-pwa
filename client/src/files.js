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

const ERRORS = {
  403: 'Здесь можно только смотреть.',
  404: 'Карточка ещё не на сервере или удалена.',
  507: 'На сервере закончилось место.',
};

/** Uploads one file to the card; `onProgress` gets 0…1. */
export function uploadFile(cardId, file, onProgress) {
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

export async function removeFile(cardId, fileId) {
  const res = await fetch(`/api/cards/${encodeURIComponent(cardId)}/files/${fileId}/delete`, {
    method: 'POST',
    headers: boardHeaders(),
  }).catch(() => null);
  if (!res?.ok) throw new Error(res ? ERRORS[res.status] ?? 'Не удалось удалить файл.' : 'Нет связи с сервером.');
  requestSync();
}

import { boardHeaders, publicToken } from './board.js';

// Until when the others have read each chat of the board (`folder:<id>`, `card:<id>`; see seen.js): the
// two ticks of the user's messages. The server keeps the marks; this device sends its own as it reads.

let reads = {};
const listeners = new Set();

export const chatReadsStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => reads,
};

export async function refreshChatReads() {
  if (publicToken || !navigator.onLine) return;
  for (const [thread, at] of [...unsent]) reportRead(thread, at);
  try {
    const res = await fetch('/api/chat-reads', { headers: boardHeaders(), cache: 'no-store' });
    if (!res.ok) return;
    reads = (await res.json()).reads ?? {};
    for (const l of listeners) l();
  } catch {
    // shown again on the next change
  }
}

// What this device has told the server, so the same mark is not sent again; marks read offline go
// with the next refresh (when the live updates connect again).
const sent = new Map();
const unsent = new Map();

export function reportRead(thread, at) {
  if (publicToken || (sent.get(thread) ?? 0) >= at) return;
  sent.set(thread, at);
  unsent.delete(thread);
  const failed = () => {
    if (sent.get(thread) === at) sent.delete(thread);
    unsent.set(thread, at);
  };
  fetch('/api/chat-reads', {
    method: 'POST',
    headers: { ...boardHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread, at }),
  }).then((res) => {
    if (res.status >= 500) failed();
  }, failed);
}

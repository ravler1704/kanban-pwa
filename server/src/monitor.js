import fs from 'node:fs';
import path from 'node:path';
import {
  db, DB_PATH, listIdentities, listMembers, listPublicLinks, ownerFileIds, ownSpaces, sharedBoards, userProfile,
} from './db.js';
import { onlineUsers } from './events.js';
import { FILES_DIR } from './files.js';

// What goes on on the server, for its administrators: users, their spaces and how much is in them.
// Counts and dates only: no names of boards, no texts of cards or messages.

const DAY_MS = 24 * 60 * 60 * 1000;

const selectUsers = db.prepare(`
  SELECT user_id AS id, MIN(linked_at) AS registered FROM identities GROUP BY user_id
  UNION ALL
  SELECT owner, MIN(created_at) FROM spaces WHERE owner NOT IN (SELECT user_id FROM identities) GROUP BY owner
`);
const selectSeen = db.prepare('SELECT user_id, seen_at FROM user_seen');
const selectCounts = db.prepare(`
  SELECT owner,
    SUM(type = 'folder' AND json_extract(data, '$.deleted') = 0) AS boards,
    SUM(type = 'card' AND json_extract(data, '$.deleted') = 0) AS cards,
    SUM(type = 'card' AND json_extract(data, '$.deleted') = 1 AND COALESCE(json_extract(data, '$.purged'), 0) = 0) AS archived,
    SUM(type = 'comment' AND json_extract(data, '$.deleted') = 0 AND json_extract(data, '$.event') IS NULL) AS messages,
    MAX(updated_at) AS changed
  FROM records GROUP BY owner
`);
const selectDevices = db.prepare('SELECT owner, COUNT(*) AS n FROM push_subscriptions GROUP BY owner');
const selectDmCount = db.prepare('SELECT COUNT(*) AS n FROM direct_messages WHERE deleted = 0');

async function sizeOf(file) {
  return (await fs.promises.stat(file).catch(() => null))?.size ?? 0;
}

async function filesTotal() {
  const names = await fs.promises.readdir(FILES_DIR).catch(() => []);
  const sizes = await Promise.all(names.map((n) => sizeOf(path.join(FILES_DIR, n))));
  return { count: names.length, bytes: sizes.reduce((a, b) => a + b, 0) };
}

const EMPTY = { boards: 0, cards: 0, archived: 0, messages: 0, changed: null };

/** `isAdmin(userId)` marks the administrators. */
export async function serverOverview(isAdmin) {
  const now = Date.now();
  const online = onlineUsers();
  const seen = new Map(selectSeen.all().map((r) => [r.user_id, r.seen_at]));
  const counts = new Map(selectCounts.all().map((r) => [r.owner, r]));
  const devices = new Map(selectDevices.all().map((r) => [r.owner, r.n]));
  const fileSizes = new Map();
  const bytesOf = async (ids) => {
    let sum = 0;
    for (const id of new Set(ids)) {
      if (!fileSizes.has(id)) fileSizes.set(id, await sizeOf(path.join(FILES_DIR, id)));
      sum += fileSizes.get(id);
    }
    return sum;
  };

  const users = [];
  for (const { id, registered } of selectUsers.all()) {
    if (!id) continue;
    const spaces = [];
    for (const space of ownSpaces(id)) {
      const c = counts.get(space.id) ?? EMPTY;
      spaces.push({
        id: space.id, name: space.name, main: Boolean(space.main),
        boards: c.boards ?? 0, cards: c.cards ?? 0, archived: c.archived ?? 0, messages: c.messages ?? 0,
        changed: c.changed, members: listMembers(space.id).length, links: listPublicLinks(space.id).length,
        fileBytes: await bytesOf(ownerFileIds(space.id)),
      });
    }
    const profile = userProfile(id);
    const sum = (key) => spaces.reduce((a, s) => a + s[key], 0);
    const changed = Math.max(0, ...spaces.map((s) => s.changed ?? 0)) || null;
    users.push({
      id, name: profile.name, email: profile.email, picture: profile.picture,
      providers: [...new Set(listIdentities(id).map((i) => i.provider))],
      admin: isAdmin(id), online: online.has(id), registered, seen: seen.get(id) ?? null, changed,
      devices: devices.get(id) ?? 0, sharedWithMe: sharedBoards(id).length,
      boards: sum('boards'), cards: sum('cards'), archived: sum('archived'), messages: sum('messages'),
      members: sum('members'), fileBytes: sum('fileBytes'), spaces,
    });
  }

  const lastActive = (u) => Math.max(u.seen ?? 0, u.online ? now : 0);
  const files = await filesTotal();
  const disk = await fs.promises.statfs(path.dirname(DB_PATH)).catch(() => null);
  return {
    at: now,
    totals: {
      users: users.length,
      online: users.filter((u) => u.online).length,
      active1: users.filter((u) => now - lastActive(u) < DAY_MS).length,
      active7: users.filter((u) => now - lastActive(u) < 7 * DAY_MS).length,
      active30: users.filter((u) => now - lastActive(u) < 30 * DAY_MS).length,
      new30: users.filter((u) => u.registered && now - u.registered < 30 * DAY_MS).length,
      spaces: users.reduce((a, u) => a + u.spaces.length, 0),
      boards: users.reduce((a, u) => a + u.boards, 0),
      cards: users.reduce((a, u) => a + u.cards, 0),
      archived: users.reduce((a, u) => a + u.archived, 0),
      messages: users.reduce((a, u) => a + u.messages, 0) + selectDmCount.get().n,
      files: files.count,
      fileBytes: files.bytes,
      dbBytes: (await sizeOf(DB_PATH)) + (await sizeOf(`${DB_PATH}-wal`)),
      diskFree: disk ? disk.bavail * disk.bsize : null,
    },
    users,
  };
}

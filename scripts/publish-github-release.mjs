#!/usr/bin/env node
/**
 * Publishes the top CHANGELOG section as a GitHub Release (tag web-YYYY-MM-DD).
 * Needs `gh` CLI and auth (`gh auth login` or GITHUB_TOKEN in CI).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import {tmpdir} from 'node:os';
import { join } from 'node:path';
import {
  formatRuDate, latestRelease, readChangelog, releaseNotesForGithub,
} from './changelog.mjs';

const SITE_URL = process.env.KANBAN_SITE_URL ?? 'https://178-83-123-195.sslip.io';
const release = latestRelease(readChangelog());
if (!release) {
  console.error('CHANGELOG: нет секции ## YYYY-MM-DD');
  process.exit(1);
}

const tag = `web-${release.date}`;
const title = `Offline Kanban — ${formatRuDate(release.date)}`;
const notes = releaseNotesForGithub(release, SITE_URL);
const dir = mkdtempSync(join(tmpdir(), 'kanban-release-'));
const notesFile = join(dir, 'notes.md');
writeFileSync(notesFile, notes, 'utf8');

const ghEnv = {
  ...process.env,
  GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
};
const gh = (...args) => spawnSync('gh', args, { stdio: 'inherit', encoding: 'utf8', env: ghEnv });
const hasTag = () => {
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore', env: ghEnv });
    return true;
  } catch {
    return false;
  }
};

if (hasTag()) {
  console.log(`Обновление релиза ${tag}…`);
  const r = gh('release', 'edit', tag, '--title', title, '--notes-file', notesFile);
  process.exit(r.status ?? 1);
}

console.log(`Новый релиз ${tag}…`);
const r = gh('release', 'create', tag, '--title', title, '--notes-file', notesFile, '--latest');
process.exit(r.status ?? 1);

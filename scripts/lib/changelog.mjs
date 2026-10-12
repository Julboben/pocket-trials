// Reads, checks and writes CHANGELOG.md, the player-facing release notes shown
// in the game's What's new screen and on GitHub Releases. The file has a fixed
// shape so it can be parsed:
//
//   ## 1.2.0 — 2026-01-31
//   ### Heads up     (important things players need to know, like a reset)
//   ### New
//   - A note, one per bullet. Indented lines continue the bullet.
//   ### Improved
//   ### Fixed
//
// Anything above the first release heading is kept as an intro.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './trails.mjs';

export const changelogPath = join(repoRoot, 'CHANGELOG.md');
export const CHANGE_TYPES = ['heads-up', 'new', 'improved', 'fixed'];
const HEADINGS = { 'heads-up': 'Heads up', new: 'New', improved: 'Improved', fixed: 'Fixed' };

/** The change type for a section heading or a typed `Changelog:` line, e.g. "Heads up" or "heads-up". */
export function changeType(name) {
  const key = name.trim().toLowerCase().replace(/[\s_-]+/g, '-');
  return CHANGE_TYPES.includes(key) ? key : key === 'headsup' ? 'heads-up' : null;
}
const SEMVER = /^\d+\.\d+\.\d+$/;
const RELEASE_HEADING = /^##\s+v?(\S+)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const DEFAULT_INTRO = '# Changelog\n\nPlayer-facing release notes. The game shows them under **What\'s new**, and each GitHub Release uses its section.\n';

/**
 * @returns {{ intro: string, releases: { version: string, date: string, changes: { type: string, text: string }[] }[], errors: string[] }}
 */
export function parseChangelog(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const releases = [];
  const errors = [];
  const introLines = [];
  let release = null, type = null, change = null;
  lines.forEach((line, i) => {
    const at = `CHANGELOG.md line ${i + 1}`;
    if (line.startsWith('## ')) {
      const match = line.match(RELEASE_HEADING);
      change = null; type = null;
      if (!match) { errors.push(`${at}: release headings must look like "## 1.2.3 — 2026-01-31".`); release = null; return; }
      release = { version: match[1], date: match[2], changes: [] };
      releases.push(release);
    } else if (!release) {
      if (!releases.length) introLines.push(line);
    } else if (line.startsWith('### ')) {
      change = null;
      type = changeType(line.slice(4));
      if (!type) errors.push(`${at}: section must be one of ${CHANGE_TYPES.map(t => HEADINGS[t]).join(', ')}.`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!type) { errors.push(`${at}: bullet is not under a ${CHANGE_TYPES.map(t => HEADINGS[t]).join(', ')} heading.`); change = null; return; }
      change = { type, text: line.replace(/^[-*]\s+/, '').trim() };
      release.changes.push(change);
    } else if (/^\s+\S/.test(line) && change) {
      change.text += ' ' + line.trim();
    } else if (line.trim()) {
      errors.push(`${at}: expected a "### Heads up/New/Improved/Fixed" heading or a "- " bullet.`);
      change = null;
    } else {
      change = null;
    }
  });
  const intro = introLines.join('\n').trim();
  return { intro: intro ? intro + '\n' : '', releases, errors };
}

export function readChangelog() {
  return parseChangelog(readFileSync(changelogPath, 'utf8'));
}

/** A release as Markdown, with or without its "## version — date" heading. */
export function releaseMarkdown(release, { heading = false } = {}) {
  const body = CHANGE_TYPES
    .map(type => [type, release.changes.filter(change => change.type === type)])
    .filter(([, changes]) => changes.length)
    .map(([type, changes]) => `### ${HEADINGS[type]}\n${changes.map(change => `- ${change.text}`).join('\n')}`)
    .join('\n\n');
  return heading ? `## ${release.version} — ${release.date}\n\n${body}` : body;
}

export function formatChangelog({ intro, releases }) {
  return `${(intro || DEFAULT_INTRO).trimEnd()}\n\n${releases.map(r => releaseMarkdown(r, { heading: true })).join('\n\n')}\n`;
}

export function writeChangelog(changelog) {
  writeFileSync(changelogPath, formatChangelog(changelog));
}

/** Compares two x.y.z versions; negative when a is older. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** @returns {string[]} problems, empty when the changelog is valid */
export function validateChangelog(changelog) {
  const errors = [...(changelog.errors || [])];
  if (!changelog.releases.length) errors.push('CHANGELOG.md has no releases.');
  changelog.releases.forEach((release, i) => {
    const at = `CHANGELOG.md ${release.version}`;
    if (!SEMVER.test(release.version)) errors.push(`${at}: version must look like 1.2.3.`);
    if (!release.changes.length) errors.push(`${at}: needs at least one note.`);
    if (release.changes.some(change => !change.text)) errors.push(`${at}: has an empty bullet.`);
    const next = changelog.releases[i + 1];
    if (next && SEMVER.test(release.version) && SEMVER.test(next.version) && compareVersions(release.version, next.version) <= 0) {
      errors.push(`${at}: releases must be newest first, with no duplicates.`);
    }
  });
  return errors;
}

/** Note text for the game, without Markdown links, emphasis or code marks. */
export function plainText(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

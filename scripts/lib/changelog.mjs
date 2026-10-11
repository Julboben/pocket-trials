// Reads, checks and formats changelog.json, the player-facing release notes
// shown in the game's What's new screen and on GitHub Releases.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './trails.mjs';

export const changelogPath = join(repoRoot, 'changelog.json');
export const CHANGE_TYPES = ['new', 'improved', 'fixed'];
const HEADINGS = { new: 'New', improved: 'Improved', fixed: 'Fixed' };
const SEMVER = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @returns {{ releases: { version: string, date: string, changes: { type: string, text: string }[] }[] }} */
export function readChangelog() {
  return JSON.parse(readFileSync(changelogPath, 'utf8'));
}

export function writeChangelog(changelog) {
  writeFileSync(changelogPath, formatChangelog(changelog));
}

/** One change per line, so diffs and hand edits stay readable. */
export function formatChangelog({ releases }) {
  const release = r => [
    '    {',
    `      "version": ${JSON.stringify(r.version)},`,
    `      "date": ${JSON.stringify(r.date)},`,
    '      "changes": [',
    r.changes.map(c => `        { "type": ${JSON.stringify(c.type)}, "text": ${JSON.stringify(c.text)} }`).join(',\n'),
    '      ]',
    '    }',
  ].join('\n');
  return `{\n  "releases": [\n${releases.map(release).join(',\n')}\n  ]\n}\n`;
}

/** Compares two x.y.z versions; negative when a is older. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** @returns {string[]} problems, empty when the changelog is valid */
export function validateChangelog(changelog) {
  const errors = [];
  if (!changelog || !Array.isArray(changelog.releases)) return ['changelog.json must have a "releases" array.'];
  changelog.releases.forEach((release, i) => {
    const at = `releases[${i}]${release?.version ? ` (${release.version})` : ''}`;
    if (!SEMVER.test(release?.version ?? '')) errors.push(`${at}: version must look like 1.2.3.`);
    if (!DATE.test(release?.date ?? '')) errors.push(`${at}: date must look like 2026-01-31.`);
    if (!Array.isArray(release?.changes) || !release.changes.length) {
      errors.push(`${at}: needs at least one change.`);
      return;
    }
    release.changes.forEach((change, j) => {
      if (!CHANGE_TYPES.includes(change?.type)) errors.push(`${at} change ${j + 1}: type must be one of ${CHANGE_TYPES.join(', ')}.`);
      if (typeof change?.text !== 'string' || !change.text.trim()) errors.push(`${at} change ${j + 1}: text is empty.`);
    });
    const next = changelog.releases[i + 1];
    if (next && SEMVER.test(release.version) && SEMVER.test(next.version) && compareVersions(release.version, next.version) <= 0) {
      errors.push(`${at}: releases must be newest first, with no duplicates.`);
    }
  });
  return errors;
}

/** Markdown for a GitHub Release or pull request body, grouped by type. */
export function releaseMarkdown(release) {
  return CHANGE_TYPES
    .map(type => [type, release.changes.filter(change => change.type === type)])
    .filter(([, changes]) => changes.length)
    .map(([type, changes]) => `### ${HEADINGS[type]}\n${changes.map(change => `- ${change.text}`).join('\n')}`)
    .join('\n\n');
}

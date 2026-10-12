// Checks CHANGELOG.md: parseable, newest first, and notes for the version in
// package.json, so a release can't ship without them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/trails.mjs';
import {
  readChangelog, parseChangelog, changeType, formatChangelog, validateChangelog, releaseMarkdown, compareVersions, plainText
} from './lib/changelog.mjs';

const changelog = readChangelog();
const errors = validateChangelog(changelog);
assert.deepEqual(errors, [], `CHANGELOG.md is invalid:\n${errors.join('\n')}`);

const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
assert.equal(changelog.releases[0]?.version, version,
  `CHANGELOG.md's newest release should be ${version} (package.json). Prepare releases with the "Prepare release" workflow or \`node scripts/release.mjs prepare\`.`);

const sample = [
  '# Changelog', '', 'Intro text.', '',
  '## 1.1.0 — 2026-02-01', '', '### Fixed', '- C.', '### New', '- A spread', '  over two lines.', '- B.', '',
  '## 1.0.0 - 2026-01-01', '### Improved', '* D.', '### heads-up', '- E.', ''
].join('\r\n');
const parsed = parseChangelog(sample);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.intro, '# Changelog\n\nIntro text.\n');
assert.deepEqual(parsed.releases.map(r => [r.version, r.date, r.changes.map(c => `${c.type}:${c.text}`)]), [
  ['1.1.0', '2026-02-01', ['fixed:C.', 'new:A spread over two lines.', 'new:B.']],
  ['1.0.0', '2026-01-01', ['improved:D.', 'heads-up:E.']]
]);
assert.deepEqual(parseChangelog(formatChangelog(parsed)).releases.map(r => r.changes.length), [3, 2]);
assert.equal(releaseMarkdown(parsed.releases[0]), '### New\n- A spread over two lines.\n- B.\n\n### Fixed\n- C.');
assert.equal(releaseMarkdown(parsed.releases[1]), '### Heads up\n- E.\n\n### Improved\n- D.');
assert.deepEqual(['Heads up', 'heads-up', 'HEADSUP', 'Fixed', 'Other'].map(changeType), ['heads-up', 'heads-up', 'heads-up', 'fixed', null]);

const broken = parseChangelog('## 1.0 today\n- loose\n## 1.0.0 — 2026-01-01\n### Other\nstray text\n');
assert.equal(broken.errors.length, 3);
assert.equal(validateChangelog({ errors: [], releases: [
  { version: '1.0.0', date: '2026-01-01', changes: [{ type: 'new', text: 'A' }] },
  { version: '1.0.0', date: '2026-01-01', changes: [] }
] }).length, 2);

assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
assert.equal(plainText('**Bold**, _soft_, `code` and [a link](https://x.y) in snake_case.'), 'Bold, soft, code and a link in snake_case.');

console.log(`Changelog test passed (${changelog.releases.length} releases, latest ${version}).`);

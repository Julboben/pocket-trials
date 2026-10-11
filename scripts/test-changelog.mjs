// Checks changelog.json: valid entries, newest first, and notes for the
// version in package.json, so a release can't ship without them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './lib/trails.mjs';
import { readChangelog, validateChangelog, releaseMarkdown, compareVersions } from './lib/changelog.mjs';

const changelog = readChangelog();
const errors = validateChangelog(changelog);
assert.deepEqual(errors, [], `changelog.json is invalid:\n${errors.join('\n')}`);

const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
assert.equal(changelog.releases[0]?.version, version,
  `changelog.json's newest release should be ${version} (package.json). Prepare releases with the "Prepare release" workflow or \`node scripts/release.mjs prepare\`.`);

assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
assert.deepEqual(validateChangelog({ releases: [
  { version: '1.0.0', date: '2026-01-01', changes: [{ type: 'new', text: 'A' }] },
  { version: '1.0.0', date: '2026-01-01', changes: [{ type: 'oops', text: '' }] }
] }).length, 3);
assert.equal(releaseMarkdown({ changes: [
  { type: 'fixed', text: 'C.' }, { type: 'new', text: 'A.' }, { type: 'new', text: 'B.' }
] }), '### New\n- A.\n- B.\n\n### Fixed\n- C.');

console.log(`Changelog test passed (${changelog.releases.length} releases, latest ${version}).`);

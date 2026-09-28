// The editor's Block and Cut gestures, checked against the real editor source.
//
// This is deliberately a source-level check rather than a reimplementation.
// An earlier version of this file reimplemented the gesture logic, which meant
// it kept passing while the editor was broken: it verified a copy, not the code
// that runs. What actually matters is the order of operations in editor.js, so
// that is what is asserted here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

let failures = 0;
const check = (label, condition) => {
  if (!condition) { failures++; console.log('FAIL', label); }
  else console.log('ok  ', label);
};

const commit = between('function commitShape(', 'function deleteSelection');
const release = between('const endPointer =', "canvas.addEventListener('pointerup'");
const down = between("canvas.addEventListener('pointerdown'", "canvas.addEventListener('pointermove'");

// 1. commitShape must take the kind as a parameter. Reading module state here is
// what broke release: the caller clears pendingKind before calling, so the block
// branch could never match.
check('commitShape takes the kind as a parameter', /function commitShape\(\s*kind\s*,/.test(commit));
check('commitShape does not read pendingKind', !/pendingKind/.test(commit));
check('the release handler passes the kind it captured', /commitShape\(\s*kind\s*,/.test(release));

// 2. The release handler must capture the kind before clearing the pending state.
const captureAt = release.indexOf('const kind = pendingKind');
const clearAt = release.indexOf('pendingShape = null');
const callAt = release.indexOf('commitShape(');
check('the kind is captured before the state is cleared',
  captureAt >= 0 && clearAt > captureAt && callAt > clearAt);

// 3. History is pushed before the shape is applied, so undo has something to
// return to. Every other edit in this editor follows the same rule.
check('history is pushed before the commit', release.indexOf('pushHistory()') < callAt);

// 4. A refused shape must not leave a no-op undo step behind.
check('a refused shape pops its history entry', /history\.pop\(\)/.test(release));

// 5. Both tools must start a pending drag, and only those two.
check('Block and Cut start a pending drag', /tool === 'block' \|\| tool === 'cut'/.test(down));
check('the pending shape records which tool it is', /pendingKind = tool/.test(down));
check('a cut drag is closed and a block drag is not', /closed: tool === 'cut'/.test(down));

// 6. The block branch must exist and be guarded only by the kind, so a cut drag
// can never fall into it or past it into the wrong branch.
check('the block branch is keyed on the kind', /if \(kind === 'block'\)/.test(commit));
check('the cut branch requires a closed outline', /if \(!closed \|\| points\.length < 3\) return false/.test(commit));

// 7. A block is only created if the drag was big enough to be one.
check('a too-small drag is rejected', /right - left < 8 \|\| bottom - top < 8/.test(commit));

console.log(failures ? `\n${failures} failing` : '\nEditor gesture source tests passed.');
process.exit(failures ? 1 : 0);

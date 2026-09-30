// The editor's Block and Cut gestures, checked against the real editor source.
//
// This is deliberately a source-level check rather than a reimplementation.
// An earlier version of this file reimplemented the gesture logic, which meant
// it kept passing while the editor was broken: it verified a copy, not the code
// that runs. What actually matters is the order of operations in editor.js, so
// that is what is asserted here. Patterns accept either quote style, because
// the source is reformatted from time to time.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/editor.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, condition) => {
  if (!condition) { failures++; console.log('FAIL', label); }
  else console.log('ok  ', label);
};

// A section from where `start` matches to where `end` next matches after it.
const indexOf = (pattern, from = 0) => {
  const match = pattern.exec(source.slice(from));
  return match ? from + match.index : -1;
};
const section = (start, end) => {
  const from = indexOf(start);
  if (from < 0) return '';
  const to = indexOf(end, from + 1);
  return source.slice(from, to < 0 ? undefined : to);
};
// The next declaration at the top level of the file ends a function.
const TOP_LEVEL = /\n(?:export )?(?:async )?(?:function |const |let )/;
const Q = `["']`;

const commit = section(/function commitShape\(/, TOP_LEVEL);
const release = section(/const endPointer =/, TOP_LEVEL);
const down = section(
  new RegExp(`canvas\\.addEventListener\\(\\s*${Q}pointerdown`),
  new RegExp(`canvas\\.addEventListener\\(\\s*${Q}pointermove`),
);

// 0. Every section must be found, or the checks below prove nothing.
check('commitShape is found', commit.length > 0);
check('the release handler is found', release.length > 0);
check('the pointerdown handler is found', down.length > 0);

// 1. commitShape must take the kind as a parameter. Reading module state here is
// what broke release: the caller clears pendingKind before calling, so the block
// branch could never match.
check('commitShape takes the kind as a parameter', /function commitShape\(\s*kind\b/.test(commit));
check('commitShape does not read pendingKind', !/pendingKind/.test(commit));
check('the release handler passes the kind it captured', /commitShape\(\s*kind\b/.test(release));

// 2. The release handler must capture the kind before clearing the pending state.
const captureAt = release.indexOf('const kind = pendingKind');
const clearAt = release.indexOf('pendingShape = null');
const callAt = release.indexOf('commitShape(');
check('the kind is captured before the state is cleared',
  captureAt >= 0 && clearAt > captureAt && callAt > clearAt);

// 3. The undo point is taken before the shape is applied, so undo returns to
// the level as it was.
const snapshotAt = release.indexOf('snapshot()');
check('the undo point is taken before the commit', snapshotAt >= 0 && snapshotAt < callAt);

// 4. Only a shape that changed something becomes an undo step, so a refused
// shape leaves no empty step and does not clear the redo history.
check('history is pushed only when the shape changed something',
  /if\s*\(\s*commitShape\([^)]*\)\s*\)\s*pushHistory\(\s*before\s*\)/.test(release));
check('no undo step is pushed unconditionally', !/pushHistory\(\s*\)/.test(release));

// 5. Both tools, and only those two, start a pending drag with a closed outline.
// Alt (rectangle) and Shift (grid snap) are read when the drag starts.
check('Block and Cut start a pending drag',
  new RegExp(`tool === ${Q}block${Q} \\|\\| tool === ${Q}cut${Q}`).test(down));
check('the pending shape records which tool it is', /pendingKind = tool/.test(down));
check('both outlines are closed', /closed:\s*true/.test(down));
check('Alt and Shift are read at the start of the drag',
  /alt:\s*event\.altKey/.test(down) && /shift:\s*event\.shiftKey/.test(down));

// 6. The block branch must exist and be guarded only by the kind, so a cut drag
// can never fall into it or past it into the wrong branch.
check('the block branch is keyed on the kind', new RegExp(`if \\(kind === ${Q}block${Q}\\)`).test(commit));
check('commitShape knows whether to make a rectangle', /function commitShape\([^)]*\brect\b/.test(commit));
check('the cut branch requires a closed outline', /if \(!closed \|\| points\.length < 3\)/.test(commit));

// 7. A block is only created if the drag was big enough to be one.
check('a too-small drag is rejected', /right - left < 8 \|\| bottom - top < 8/.test(commit));

console.log(failures ? `${failures} failing` : '\nEditor gesture source tests passed.');
process.exit(failures ? 1 : 0);

const round = value => Number.isFinite(value) ? Number(value.toFixed(3)) : value;

export function createPhysicsDebugger({ enabled, step, inspectPoint }) {
  const frames = [];
  const spikes = [];
  let frame = null;
  let iteration = -1;
  let lastAlert = -Infinity;
  let recording = false;
  let recordedInputs = [];
  let replayInputs = [];
  let replayIndex = 0;

  function snapshot(point) {
    return {
      x: round(point.x),
      y: round(point.y),
      vx: round((point.x - point.ox) / step),
      vy: round((point.y - point.oy) / step),
      grounded: point.grounded,
      angularVelocity: round(point.angularVelocity || 0),
      contact: point.contact ? {
        kind: point.contact.kind,
        nx: round(point.contact.nx),
        ny: round(point.contact.ny),
        swept: Boolean(point.contact.swept)
      } : null,
      ...inspectPoint(point, round)
    };
  }

  function begin(metadata, rear, front) {
    if (!enabled || metadata.state !== 'running') return;
    frame = {
      time: round(metadata.time),
      level: metadata.level,
      source: metadata.source,
      physicsVersion: metadata.physicsVersion,
      facing: metadata.facing,
      throttle: round(metadata.throttle),
      before: { rear: snapshot(rear), front: snapshot(front) },
      maxConstraintCorrection: 0,
      constraints: [],
      contacts: [],
      traction: []
    };
  }

  function recordInput(input) {
    if (frame) frame.input = { ...input };
    if (recording) recordedInputs.push({ ...input });
  }

  function nextReplayInput() {
    if (replayIndex >= replayInputs.length) return null;
    return replayInputs[replayIndex++];
  }

  function capture(name, rear, front) {
    if (frame) frame[name] = { rear: snapshot(rear), front: snapshot(front) };
  }

  function setIteration(nextIteration) {
    iteration = nextIteration;
  }

  function recordConstraint(correction, rear, front) {
    if (!frame) return;
    frame.maxConstraintCorrection = Math.max(frame.maxConstraintCorrection, correction.correctionDistance);
    frame.constraints.push({
      iteration,
      distance: round(correction.distance),
      correctionDistance: round(correction.correctionDistance),
      correctionX: round(correction.correctionX),
      correctionY: round(correction.correctionY),
      afterCorrection: { rear: snapshot(rear), front: snapshot(front) }
    });
  }

  function recordContactsResolved(rear, front) {
    if (!frame || !frame.constraints.length) return;
    frame.constraints.at(-1).afterContacts = { rear: snapshot(rear), front: snapshot(front) };
  }

  function recordContact({ wheel, contact, beforeX, beforeY, beforeVx, beforeVy, point, afterVx, afterVy }) {
    if (!frame) return;
    frame.contacts.push({
      iteration,
      wheel,
      kind: contact.kind || 'unknown',
      x: round(beforeX),
      y: round(beforeY),
      penetration: round(contact.penetration),
      nx: round(contact.nx),
      ny: round(contact.ny),
      curveSlope: round(contact.slope),
      segmentSlope: round(contact.segmentSlope),
      correctionX: round(point.x - beforeX),
      correctionY: round(point.y - beforeY),
      velocityBeforeX: round(beforeVx / step),
      velocityBeforeY: round(beforeVy / step),
      velocityAfterX: round(afterVx / step),
      velocityAfterY: round(afterVy / step)
    });
  }

  function recordDynamics(values) {
    if (!frame) return;
    frame.dynamics = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value)]));
  }

  function recordTraction(wheel, result, point) {
    if (!frame) return;
    frame.traction.push({
      wheel,
      slip: round(result.slip),
      normalImpulse: round(result.normalImpulse),
      tangentImpulse: round(result.tangentImpulse),
      angularVelocity: round(point.angularVelocity || 0),
      vx: round((point.x - point.ox) / step),
      vy: round((point.y - point.oy) / step)
    });
  }

  function finish(rear, front) {
    if (!frame) return;
    frame.after = { rear: snapshot(rear), front: snapshot(front) };
    const beforeSpeedX = (frame.before.rear.vx + frame.before.front.vx) / 2;
    const afterSpeedX = (frame.after.rear.vx + frame.after.front.vx) / 2;
    const beforeSpeedY = (frame.before.rear.vy + frame.before.front.vy) / 2;
    const afterSpeedY = (frame.after.rear.vy + frame.after.front.vy) / 2;
    frame.centerVelocityChange = {
      x: round(afterSpeedX - beforeSpeedX),
      y: round(afterSpeedY - beforeSpeedY)
    };
    frame.wheelVelocityChanges = {
      rear: {
        x: round(frame.after.rear.vx - frame.before.rear.vx),
        y: round(frame.after.rear.vy - frame.before.rear.vy)
      },
      front: {
        x: round(frame.after.front.vx - frame.before.front.vx),
        y: round(frame.after.front.vy - frame.before.front.vy)
      }
    };
    frames.push(frame);
    if (frames.length > 360) frames.shift();
    const velocityChanges = [
      frame.centerVelocityChange.x,
      frame.centerVelocityChange.y,
      frame.wheelVelocityChanges.rear.x,
      frame.wheelVelocityChanges.rear.y,
      frame.wheelVelocityChanges.front.x,
      frame.wheelVelocityChanges.front.y
    ];
    const suddenAcceleration = velocityChanges.some(change => Math.abs(change) > 80);
    if (suddenAcceleration && performance.now() - lastAlert > 1000) {
      lastAlert = performance.now();
      spikes.push(frame);
      if (spikes.length > 20) spikes.shift();
      console.warn('[Pocket Trials] Sudden physics acceleration detected.');
      console.table(frame.contacts);
      console.log('[Pocket Trials] Copyable spike JSON:\n' + JSON.stringify(frame, null, 2));
    }
    frame = null;
  }

  const publicApi = {
    enabled,
    frames,
    spikes,
    clear() { frames.length = 0; spikes.length = 0; },
    startRecording() { recordedInputs = []; recording = true; },
    stopRecording() { recording = false; return recordedInputs.map(input => ({ ...input })); },
    replay(inputs) {
      replayInputs = Array.isArray(inputs) ? inputs.map(input => ({ ...input })) : [];
      replayIndex = 0;
      return replayInputs.length;
    },
    stopReplay() { replayInputs = []; replayIndex = 0; },
    dump() {
      const trace = frames.slice(-120);
      console.log('[Pocket Trials] Physics trace', trace);
      return trace;
    },
    dumpSpike() {
      const spike = spikes.at(-1) || null;
      console.log('[Pocket Trials] Latest spike JSON:\n' + JSON.stringify(spike, null, 2));
      return spike;
    },
    async copy() {
      await navigator.clipboard.writeText(JSON.stringify(frames.slice(-120), null, 2));
      console.log('[Pocket Trials] Copied the latest physics trace.');
    },
    async copySpike() {
      await navigator.clipboard.writeText(JSON.stringify(spikes.at(-1) || null, null, 2));
      console.log('[Pocket Trials] Copied the latest sudden-acceleration frame.');
    }
  };

  globalThis.pocketTrialsPhysicsDebug = publicApi;
  if (enabled) console.info('[Pocket Trials] Physics tracing enabled. Reproduce a spike, then run pocketTrialsPhysicsDebug.dumpSpike() or copySpike().');

  return { begin, recordInput, nextReplayInput, capture, setIteration, recordConstraint, recordContactsResolved, recordContact, recordDynamics, recordTraction, finish };
}

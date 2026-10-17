const round = value => Number.isFinite(value) ? Number(value.toFixed(3)) : value;

export function createPhysicsDebugger({ enabled, step, inspectPoint }) {
  const frames = [];
  let frame = null;
  let iteration = -1;

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
      trail: metadata.trail,
      source: metadata.source,
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
      slope: round(contact.slope),
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
    frame = null;
  }

  if (enabled) {
    globalThis.hjulbenPhysicsDebug = {
      frames,
      clear() { frames.length = 0; },
      dump() {
        const trace = frames.slice(-120);
        console.log('[Hjulben] Physics trace', trace);
        return trace;
      },
      async copy() {
        await navigator.clipboard.writeText(JSON.stringify(frames.slice(-120), null, 2));
        console.log('[Hjulben] Copied the latest physics trace.');
      }
    };
    console.info('[Hjulben] Debug mode. hjulbenGame.dumpRun() copies the whole attempt; hjulbenPhysicsDebug.dump() or copy() the last 120 steps in detail.');
  }

  return { begin, recordInput, capture, setIteration, recordConstraint, recordContactsResolved, recordContact, recordDynamics, recordTraction, finish };
}

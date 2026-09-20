import assert from 'node:assert/strict';
import {
  assertDisplayCurveHonesty,
  buildDisplayCurveFromAnchors,
  engineAnchorPoints
} from '../lib/graphDisplayCurve.js';
import { GRAPH_RENDERING_POLICY } from '../lib/graphRenderingPolicy.js';

function assertNoIssues(anchors, cycleKey = 'daewoon') {
  const { displayY, anchorIndices, engineAnchorYs } = buildDisplayCurveFromAnchors(
    anchors,
    cycleKey
  );
  const issues = assertDisplayCurveHonesty(engineAnchorYs, displayY, anchorIndices);
  assert.equal(issues.length, 0, issues.join('; '));
  return { displayY, anchorIndices, engineAnchorYs };
}

function run() {
  // CASE A
  const a = assertNoIssues([0, -30], 'daewoon');
  for (const y of a.displayY) {
    assert.ok(y <= 0 && y >= -30, `CASE A out of range: ${y}`);
  }

  // CASE B
  const b = assertNoIssues([-30, 40], 'daewoon');
  for (const y of b.displayY) {
    assert.ok(y >= -30 && y <= 40, `CASE B out of range: ${y}`);
  }

  // CASE C — exact anchors (daewoon example shape)
  const c = assertNoIssues([8, 0, -28, 35], 'daewoon');
  for (let i = 0; i < c.engineAnchorYs.length; i++) {
    assert.equal(c.displayY[c.anchorIndices[i]], c.engineAnchorYs[i]);
  }

  // CASE D — same anchors, different time scale policy
  const d1 = buildDisplayCurveFromAnchors([10, 0, -20, 30], 'daewoon');
  const d2 = buildDisplayCurveFromAnchors([10, 0, -20, 30], 'hour');
  assert.deepEqual(d1.engineAnchorYs, d2.engineAnchorYs);
  assert.notEqual(d1.displayY.length, d2.displayY.length);

  // CASE E — presentation module does not export engine mutation
  const engine = engineAnchorPoints([1, 2, 3]);
  assert.deepEqual(engine, [1, 2, 3]);

  assert.equal(GRAPH_RENDERING_POLICY.daewoon.allowOvershoot, false);

  console.log('testGraphDisplayCurve: ok');
}

run();

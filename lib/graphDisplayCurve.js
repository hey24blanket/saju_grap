import {
  getGraphRenderingPolicy,
  GRAPH_SCORE_Y_MAX,
  GRAPH_SCORE_Y_MIN
} from './graphRenderingPolicy.js';

/**
 * Engine anchor scores (immutable facts from cyclesData).
 * @param {number[]} values
 * @returns {number[]}
 */
export function engineAnchorPoints(values) {
  if (!Array.isArray(values)) return [];
  return values.map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function segmentBounds(y0, y1) {
  return {
    min: Math.min(y0, y1),
    max: Math.max(y0, y1)
  };
}

/** PCHIP slopes (Fritsch–Carlson). */
function pchipSlopes(x, y) {
  const n = y.length;
  if (n < 2) return [0];

  const h = [];
  const delta = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = x[i + 1] - x[i];
    h[i] = dx === 0 ? 1 : dx;
    delta[i] = (y[i + 1] - y[i]) / h[i];
  }

  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] === 0 || delta[i] === 0 || delta[i - 1] * delta[i] < 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  return m;
}

function hermiteEval(x0, x1, y0, y1, m0, m1, x) {
  const h = x1 - x0;
  if (h === 0) return y0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

function interpolateAt(xAnchors, yAnchors, slopes, x) {
  if (x <= xAnchors[0]) return yAnchors[0];
  const last = xAnchors.length - 1;
  if (x >= xAnchors[last]) return yAnchors[last];

  let i = 0;
  while (i < last - 1 && x > xAnchors[i + 1]) i++;

  return hermiteEval(
    xAnchors[i],
    xAnchors[i + 1],
    yAnchors[i],
    yAnchors[i + 1],
    slopes[i],
    slopes[i + 1],
    x
  );
}

function linearAt(xAnchors, yAnchors, x) {
  if (x <= xAnchors[0]) return yAnchors[0];
  const last = xAnchors.length - 1;
  if (x >= xAnchors[last]) return yAnchors[last];

  let i = 0;
  while (i < last - 1 && x > xAnchors[i + 1]) i++;

  const x0 = xAnchors[i];
  const x1 = xAnchors[i + 1];
  const y0 = yAnchors[i];
  const y1 = yAnchors[i + 1];
  const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

function enforceSegmentBounds(y, segmentStart, y0, y1) {
  const { min, max } = segmentBounds(y0, y1);
  return clamp(y, min, max);
}

function applySlopeClamp(values, maxDelta) {
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) return values;
  const out = values.slice();
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const delta = out[i] - prev;
    if (delta > maxDelta) out[i] = prev + maxDelta;
    else if (delta < -maxDelta) out[i] = prev - maxDelta;
  }
  for (let i = out.length - 2; i >= 0; i--) {
    const next = out[i + 1];
    const delta = next - out[i];
    if (delta > maxDelta) out[i] = next - maxDelta;
    else if (delta < -maxDelta) out[i] = next + maxDelta;
  }
  return out;
}

/**
 * Build presentation-only display curve from engine anchors.
 * @param {number[]} anchorYs
 * @param {string} cycleKey
 * @returns {{
 *   displayY: number[],
 *   anchorIndices: number[],
 *   engineAnchorYs: number[],
 *   policy: object,
 *   presentationOnly: true
 * }}
 */
export function buildDisplayCurveFromAnchors(anchorYs, cycleKey) {
  const policy = getGraphRenderingPolicy(cycleKey);
  const engineAnchorYs = engineAnchorPoints(anchorYs);
  const n = engineAnchorYs.length;

  if (n === 0) {
    return {
      displayY: [],
      anchorIndices: [],
      engineAnchorYs,
      policy,
      presentationOnly: true
    };
  }

  if (n === 1) {
    return {
      displayY: [engineAnchorYs[0]],
      anchorIndices: [0],
      engineAnchorYs,
      policy,
      presentationOnly: true
    };
  }

  const xAnchors = engineAnchorYs.map((_, i) => i);
  const slopes =
    policy.interpolation === 'linear'
      ? null
      : pchipSlopes(xAnchors, engineAnchorYs);

  const samplesPerSegment = Math.max(1, Math.floor(policy.samplesPerSegment));
  const displayY = [];
  const anchorIndices = engineAnchorYs.map((_, anchorIndex) => anchorIndex * samplesPerSegment);
  const totalSteps = (n - 1) * samplesPerSegment;

  for (let step = 0; step <= totalSteps; step++) {
    const x = step / samplesPerSegment;
    const seg = Math.min(n - 2, Math.floor(x));
    const y0 = engineAnchorYs[seg];
    const y1 = engineAnchorYs[seg + 1];

    let y =
      policy.interpolation === 'linear'
        ? linearAt(xAnchors, engineAnchorYs, x)
        : interpolateAt(xAnchors, engineAnchorYs, slopes, x);

    if (!policy.allowOvershoot) {
      y = enforceSegmentBounds(y, seg, y0, y1);
    }

    y = clamp(y, GRAPH_SCORE_Y_MIN, GRAPH_SCORE_Y_MAX);
    displayY.push(y);
  }
  displayY[anchorIndices[0]] = engineAnchorYs[0];
  displayY[anchorIndices[n - 1]] = engineAnchorYs[n - 1];
  for (let a = 1; a < n - 1; a++) {
    displayY[anchorIndices[a]] = engineAnchorYs[a];
  }

  let smoothed = applySlopeClamp(displayY, policy.maxDisplayDeltaPerStep);

  for (let a = 0; a < n; a++) {
    smoothed[anchorIndices[a]] = engineAnchorYs[a];
  }

  return {
    displayY: smoothed,
    anchorIndices,
    engineAnchorYs,
    policy,
    presentationOnly: true
  };
}

export function snapDisplayIndexToAnchor(displayIndex, anchorIndices) {
  if (!anchorIndices?.length) return 0;
  let best = 0;
  let minDist = Infinity;
  for (let a = 0; a < anchorIndices.length; a++) {
    const dist = Math.abs(anchorIndices[a] - displayIndex);
    if (dist < minDist) {
      minDist = dist;
      best = a;
    }
  }
  return best;
}

/**
 * Validate display curve honesty (for tests).
 */
export function assertDisplayCurveHonesty(engineAnchorYs, displayY, anchorIndices) {
  const issues = [];
  const n = engineAnchorYs.length;

  for (let a = 0; a < n; a++) {
    const idx = anchorIndices[a];
    if (displayY[idx] !== engineAnchorYs[a]) {
      issues.push(`anchor ${a} mismatch at ${idx}`);
    }
  }

  for (let seg = 0; seg < n - 1; seg++) {
    const start = anchorIndices[seg];
    const end = anchorIndices[seg + 1];
    const { min, max } = segmentBounds(engineAnchorYs[seg], engineAnchorYs[seg + 1]);
    for (let i = start; i <= end; i++) {
      if (displayY[i] < min - 1e-9 || displayY[i] > max + 1e-9) {
        issues.push(`overshoot seg ${seg} at ${i}: ${displayY[i]} not in [${min},${max}]`);
      }
    }
  }

  for (let seg = 0; seg < n - 1; seg++) {
    const start = anchorIndices[seg];
    const end = anchorIndices[seg + 1];
    const y0 = engineAnchorYs[seg];
    const y1 = engineAnchorYs[seg + 1];
    const increasing = y1 >= y0;
    const decreasing = y1 <= y0;
    if (increasing) {
      for (let i = start + 1; i < end; i++) {
        if (displayY[i] < displayY[i - 1] - 1e-9 || displayY[i] > displayY[i + 1] + 1e-9) {
          issues.push(`local extremum seg ${seg} at ${i}`);
        }
      }
    } else if (decreasing) {
      for (let i = start + 1; i < end; i++) {
        if (displayY[i] > displayY[i - 1] + 1e-9 || displayY[i] < displayY[i + 1] - 1e-9) {
          issues.push(`local extremum seg ${seg} at ${i}`);
        }
      }
    }
  }

  return issues;
}

export { getGraphRenderingPolicy, GRAPH_RENDERING_POLICY } from './graphRenderingPolicy.js';

// Graph Rendering Policy v1 — presentation-only; does not alter Engine scores.

export const GRAPH_SCORE_Y_MIN = -100;
export const GRAPH_SCORE_Y_MAX = 100;

/** @typedef {'pchip' | 'linear'} GraphInterpolationMode */

/**
 * Per time-scale display policy (UI only).
 * samplesPerSegment: interior samples between consecutive engine anchors.
 */
export const GRAPH_RENDERING_POLICY = {
  daewoon: {
    interpolation: 'pchip',
    samplesPerSegment: 20,
    allowOvershoot: false,
    maxDisplayDeltaPerStep: 8,
    chartTension: 0,
    areaFillMaxOpacity: 0.08
  },
  year: {
    interpolation: 'pchip',
    samplesPerSegment: 12,
    allowOvershoot: false,
    maxDisplayDeltaPerStep: 10,
    chartTension: 0,
    areaFillMaxOpacity: 0.1
  },
  month: {
    interpolation: 'pchip',
    samplesPerSegment: 8,
    allowOvershoot: false,
    maxDisplayDeltaPerStep: 12,
    chartTension: 0,
    areaFillMaxOpacity: 0.1
  },
  day: {
    interpolation: 'pchip',
    samplesPerSegment: 6,
    allowOvershoot: false,
    maxDisplayDeltaPerStep: 14,
    chartTension: 0,
    areaFillMaxOpacity: 0.11
  },
  hour: {
    interpolation: 'pchip',
    samplesPerSegment: 4,
    allowOvershoot: false,
    maxDisplayDeltaPerStep: 16,
    chartTension: 0,
    areaFillMaxOpacity: 0.12
  }
};

export function getGraphRenderingPolicy(cycleKey) {
  return GRAPH_RENDERING_POLICY[cycleKey] || GRAPH_RENDERING_POLICY.daewoon;
}

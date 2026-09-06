/* Verifies that Metric Catalog exposes definitions without evaluation behavior. */
import { describe, expect, it } from 'vitest';
import {
  getMetricDefinition,
  listMetricDefinitions,
} from '../../evals/agent/metrics/metric-catalog';

describe('Evaluation Metric Catalog', () => {
  it('contains every confirmed definition and no evaluator configuration', () => {
    const definitions = listMetricDefinitions();

    expect(definitions).toHaveLength(50);
    expect(new Set(definitions.map((definition) => definition.metricId)).size).toBe(44);
    expect(definitions.map((definition) => definition.metricId)).toContain('common.goal_completion');
    expect(definitions.map((definition) => definition.metricId)).toContain('recommendation.relevance');
    expect(definitions.map((definition) => definition.metricId)).toContain('efficiency.retries');
    for (const definition of definitions) {
      expect(Object.keys(definition).sort()).toEqual([
        'definition',
        'metricId',
        'name',
        'quantification',
        'scope',
      ]);
      expect(definition).not.toHaveProperty('evaluator');
      expect(definition).not.toHaveProperty('threshold');
      expect(definition).not.toHaveProperty('weight');
      expect(definition).not.toHaveProperty('score');
      expect(definition).not.toHaveProperty('grader');
    }
  });

  it('reads one definition by stable Metric ID and filters by scope', () => {
    expect(getMetricDefinition('interest.recognition_precision')).toMatchObject({
      name: '兴趣识别准确率',
      scope: 'interest_understanding',
    });
    expect(getMetricDefinition('missing.metric')).toBeUndefined();
    expect(listMetricDefinitions({ scope: 'conversation' })).toHaveLength(6);
  });
});

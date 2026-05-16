import type { AlertRepository } from '@roles/detector/repository/alert.repository';
import { AlertEvaluator } from './alert-evaluator.service';

function makeRepo(counts: { deadLetters?: number; failedOrders?: number }): AlertRepository {
  return {
    insert: async () => 'inserted',
    countDeadLettersSince: async () => counts.deadLetters ?? 0,
    countFailedOrdersSince: async () => counts.failedOrders ?? 0,
  };
}

describe('AlertEvaluator', () => {
  it('emits no candidates when counts are under thresholds', async () => {
    const evaluator = new AlertEvaluator(makeRepo({ deadLetters: 10, failedOrders: 0 }));

    const candidates = await evaluator.evaluate();

    expect(candidates).toEqual([]);
  });

  it('emits warning dead-letter alert at threshold', async () => {
    const evaluator = new AlertEvaluator(makeRepo({ deadLetters: 100 }));

    const candidates = await evaluator.evaluate();

    expect(candidates).toHaveLength(1);

    expect(candidates[0].category).toBe('dead-letter-spike');

    expect(candidates[0].severity).toBe('warning');
  });

  it('escalates dead-letter to critical above critical threshold', async () => {
    const evaluator = new AlertEvaluator(makeRepo({ deadLetters: 500 }));

    const candidates = await evaluator.evaluate();

    expect(candidates[0].severity).toBe('critical');
  });

  it('emits order-rejection alert independently of dead-letter', async () => {
    const evaluator = new AlertEvaluator(makeRepo({ failedOrders: 10 }));

    const candidates = await evaluator.evaluate();

    expect(candidates).toHaveLength(1);

    expect(candidates[0].category).toBe('order-rejection-spike');

    expect(candidates[0].severity).toBe('warning');
  });

  it('emits both alerts when both rules trip', async () => {
    const evaluator = new AlertEvaluator(makeRepo({ deadLetters: 100, failedOrders: 25 }));

    const candidates = await evaluator.evaluate();

    expect(candidates).toHaveLength(2);

    expect(candidates.map((c) => c.category)).toEqual(
      expect.arrayContaining(['dead-letter-spike', 'order-rejection-spike']),
    );
  });
});

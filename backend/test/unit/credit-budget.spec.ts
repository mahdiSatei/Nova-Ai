import {
  CHARS_PER_TOKEN_ESTIMATE,
  createCreditBudget,
  estimateOutputTokens,
} from '../../src/modules/chat/credit-budget';

describe('credit-budget (§3.8)', () => {
  it('uses a conservative 3 chars-per-token estimate that rounds up', () => {
    expect(CHARS_PER_TOKEN_ESTIMATE).toBe(3);
    expect(estimateOutputTokens(1)).toBe(1);
    expect(estimateOutputTokens(4)).toBe(2);
    expect(estimateOutputTokens(3000)).toBe(1000);
  });

  it('trips strictly above the boundary', () => {
    const budget = createCreditBudget(7);
    expect(budget.boundaryCredits).toBe(7);
    expect(budget.exceeded(6.9999)).toBe(false);
    expect(budget.exceeded(7)).toBe(false);
    expect(budget.exceeded(7.0001)).toBe(true);
  });
});

import { UsageService } from '../../src/modules/usage/usage.service';

function build() {
  const record = { id: 'u1', searchCredits: 0, save: jest.fn().mockResolvedValue(undefined) };
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn().mockResolvedValue(record),
    findOne: jest.fn().mockResolvedValue(record),
  };
  return { service: new UsageService(repo as never), record, repo };
}

describe('UsageService search credits', () => {
  it('stores search credits passed to finalize', async () => {
    const { service, record } = build();
    await service.finalize('u1', {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      chargedCost: 0,
      chargedCredits: 0,
      status: 'completed',
      searchCredits: 4,
    });
    expect(record.searchCredits).toBe(4);
  });

  it('defaults search credits to zero', async () => {
    const { service, record } = build();
    await service.finalize('u1', {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      chargedCost: 0,
      chargedCredits: 0,
      status: 'failed',
    });
    expect(record.searchCredits).toBe(0);
  });
});

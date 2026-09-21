import { UsageService } from '../../src/modules/usage/usage.service';

function build() {
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return { service: new UsageService(repo as never), repo };
}

describe('UsageService search credits', () => {
  it('stores search credits passed to finalizeOnce', async () => {
    const { service, repo } = build();
    await service.finalizeOnce('u1', {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      chargedCost: 0,
      chargedCredits: 0,
      status: 'completed',
      searchCredits: 4,
    });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'u1', status: 'pending' },
      expect.objectContaining({ searchCredits: 4 }),
    );
  });

  it('defaults search credits to zero', async () => {
    const { service, repo } = build();
    await service.finalizeOnce('u1', {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      chargedCost: 0,
      chargedCredits: 0,
      status: 'failed',
    });
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'u1', status: 'pending' },
      expect.objectContaining({ searchCredits: 0, chargedCredits: 0 }),
    );
  });
});

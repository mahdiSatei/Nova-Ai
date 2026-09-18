import { QuotasUserController } from '../../src/modules/quotas/quotas.user.controller';

describe('QuotasUserController', () => {
  let controller: QuotasUserController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getForUser: jest.fn().mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45000,
        tokenRemaining: 55000,
        lastResetAt: new Date('2026-10-18T00:00:00Z'),
      }),
    };
    controller = new QuotasUserController(mockService);
  });

  it('me returns the current user quota', async () => {
    const result = await controller.me({ id: 'user-1', role: 'user', email: 'u@example.com' } as any);
    expect(result).toEqual({
      tokenLimit: 100000,
      tokenUsed: 45000,
      tokenRemaining: 55000,
      costLimit: null,
      resetAt: '2026-10-18T00:00:00.000Z',
    });
    expect(mockService.getForUser).toHaveBeenCalledWith('user-1');
  });

  it('me throws 404 when no quota is configured', async () => {
    mockService.getForUser.mockResolvedValue(null);
    await expect(
      controller.me({ id: 'user-1', role: 'user', email: 'u@example.com' } as any),
    ).rejects.toThrow();
  });
});

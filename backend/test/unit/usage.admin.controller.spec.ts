import { UsageAdminController } from '../../src/modules/usage/usage.admin.controller';

describe('UsageAdminController', () => {
  let controller: UsageAdminController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      listForAdmin: jest.fn(async () => ({
        items: [],
        total: 0,
        totals: { totalTokens: 0, totalCost: 0, requestCount: 0 },
      })),
    };
    controller = new UsageAdminController(mockService);
  });

  it('calls listForAdmin with parsed query params', async () => {
    const result = await controller.list({
      userId: 'user-1',
      modelId: 'model-1',
      limit: 10,
      offset: 0,
    });
    expect(mockService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        modelId: 'model-1',
        limit: 10,
        offset: 0,
      }),
    );
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('totals');
  });

  it('defaults limit to 20 and offset to 0', async () => {
    await controller.list({});
    expect(mockService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('parses date strings to Date objects', async () => {
    await controller.list({
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T23:59:59Z',
    });
    expect(mockService.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(Date),
        to: expect.any(Date),
      }),
    );
  });
});

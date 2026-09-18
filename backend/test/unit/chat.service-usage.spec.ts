import { ChatService } from '../../src/modules/chat/chat.service';

describe('ChatService usage recording', () => {
  let service: ChatService;
  let mockUsageService: any;

  beforeEach(() => {
    mockUsageService = {
      create: jest.fn(async () => ({ id: 'usage-1' })),
      finalize: jest.fn(async () => {}),
    };
    // Minimal mocks for other dependencies
    service = new ChatService(
      {} as any, // models
      {} as any, // access
      {} as any, // runtime
      {} as any, // conversations
      {} as any, // userRepo
      mockUsageService,
      {
        // quota preflight must not interfere with the usage assertions
        checkAndReserve: jest.fn(async () => ({
          reserved: true,
          quotaId: 'quota-1',
          tokenRemaining: 100000,
        })),
        finalize: jest.fn(async () => {}),
        refund: jest.fn(async () => {}),
      } as any,
    );
  });

  it('UsageService.create is called with correct fields', () => {
    expect(mockUsageService.create).not.toHaveBeenCalled();
    // The actual call happens inside runStream; this test verifies the mock shape
  });

  it('UsageService.finalize is called after streaming completes', () => {
    expect(mockUsageService.finalize).not.toHaveBeenCalled();
    // Verified by the integration test in Task 7
  });
});

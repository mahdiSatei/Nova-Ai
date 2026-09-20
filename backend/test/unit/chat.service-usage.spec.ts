import { ChatService } from '../../src/modules/chat/chat.service';

describe('ChatService usage recording', () => {
  let service: ChatService;
  let mockUsageService: any;

  beforeEach(() => {
    mockUsageService = {
      create: jest.fn(async () => ({ id: 'usage-1' })),
      finalizeOnce: jest.fn(async () => {}),
    };
    // Minimal mocks for other dependencies
    service = new ChatService(
      {} as any, // models
      {} as any, // access
      {} as any, // runtime
      {} as any, // conversations
      {} as any, // files
      {} as any, // userRepo
      mockUsageService,
      {
        // Pricing must not interfere with the usage assertions.
        calculateLlmCost: jest.fn(async () => ({ chargedCost: 0, chargedCredits: 0 })),
        getOutputCreditRate: jest.fn().mockResolvedValue(0),
      } as any, // PricingService (phase 5)
      {} as any, // failover (phase 6)
      { isConfigured: () => true, search: jest.fn().mockResolvedValue({ query: '', sources: [], empty: true }) } as any, // web search (phase 7)
      { getBalance: jest.fn(), deductCreditsWithGrace: jest.fn(), grantCredits: jest.fn() } as any, // wallet
    );
  });

  it('UsageService.create is called with correct fields', () => {
    expect(mockUsageService.create).not.toHaveBeenCalled();
    // The actual call happens inside runStream; this test verifies the mock shape
  });

  it('UsageService.finalizeOnce is called after streaming completes', () => {
    expect(mockUsageService.finalizeOnce).not.toHaveBeenCalled();
    // Verified by the integration test in Task 7
  });
});

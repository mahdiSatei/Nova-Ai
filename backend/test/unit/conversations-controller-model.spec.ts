import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsController } from '../../src/modules/conversations/conversations.controller';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';

describe('ConversationsController.setModel', () => {
  let controller: ConversationsController;
  let conversations: { setModel: jest.Mock };
  let models: { findById: jest.Mock };
  let access: { assertCanUseModel: jest.Mock };

  const conversation = {
    id: 'conv-1',
    modelId: 'pub',
    title: 't',
    pinned: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    conversations = { setModel: jest.fn().mockResolvedValue(conversation) };
    models = { findById: jest.fn() };
    access = { assertCanUseModel: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        { provide: ConversationsService, useValue: conversations },
        { provide: ModelsService, useValue: models },
        { provide: ModelAccessService, useValue: access },
      ],
    }).compile();

    controller = moduleRef.get(ConversationsController);
  });

  it('maps an unknown model to 422 model_unavailable (never a 404)', async () => {
    models.findById.mockRejectedValue(
      new NotFoundException({ code: 'model_not_found', message: 'Model not found.' }),
    );

    const err = await controller
      .setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'nope' })
      .catch((e) => e);

    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toMatchObject({ code: 'model_unavailable' });
    expect(conversations.setModel).not.toHaveBeenCalled();
  });

  it('delegates entitlement to ModelAccessService and returns the updated summary', async () => {
    models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });

    const result = await controller.setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'com' });

    expect(access.assertCanUseModel).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ id: 'com' }),
    );
    expect(result.id).toBe('conv-1');
  });

  it('propagates the 403 model_forbidden raised by the policy service', async () => {
    models.findById.mockResolvedValue({ id: 'priv', enabled: true, visibility: 'private' });
    access.assertCanUseModel.mockRejectedValue(
      new ForbiddenException({ code: 'model_forbidden', message: 'no' }),
    );

    const err = await controller
      .setModel({ id: 'u-1' } as never, 'conv-1', { modelId: 'priv' })
      .catch((e) => e);

    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
    expect(conversations.setModel).not.toHaveBeenCalled();
  });
});

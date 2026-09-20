import { AuditService, SYSTEM_ACTOR_ID } from '../../src/modules/audit/audit.service'

function buildService() {
  const repo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    createQueryBuilder: jest.fn(),
  }
  return { service: new AuditService(repo as never), repo }
}

describe('AuditService result inference', () => {
  it('records payment failures as failure instead of the database success default', async () => {
    const { service, repo } = buildService()

    await service.log({
      actorId: 'user-1',
      action: 'payment_failed',
      targetType: 'payment',
      targetId: 'payment-1',
    })

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'failure' }),
    )
  })

  it('marks system events as system when no result is supplied', async () => {
    const { service, repo } = buildService()

    await service.log({
      actorId: SYSTEM_ACTOR_ID,
      action: 'credit_granted',
      targetType: 'wallet',
    })

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'system' }),
    )
  })
})

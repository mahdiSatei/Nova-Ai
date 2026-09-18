import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useQuota } from '@/composables/useQuota'
import * as quotaApi from '@/api/quota'

vi.mock('@/api/quota', () => ({
  getMyQuota: vi.fn(),
}))

describe('useQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads quota and computes remaining label', async () => {
    vi.mocked(quotaApi.getMyQuota).mockResolvedValue({
      tokenLimit: 100000,
      tokenUsed: 45000,
      tokenRemaining: 55000,
      costLimit: null,
      resetAt: null,
    })

    const { loadQuota, quota, isExhausted, percentUsed } = useQuota()
    await loadQuota()

    expect(quota.value?.tokenRemaining).toBe(55000)
    expect(percentUsed.value).toBe(45)
    expect(isExhausted.value).toBe(false)
  })

  it('treats tokenLimit 0 as unlimited', async () => {
    vi.mocked(quotaApi.getMyQuota).mockResolvedValue({
      tokenLimit: 0,
      tokenUsed: 5000,
      tokenRemaining: 0,
      costLimit: null,
      resetAt: null,
    })

    const { loadQuota, isUnlimited, isExhausted, remainingLabel } = useQuota()
    await loadQuota()

    expect(isUnlimited.value).toBe(true)
    expect(isExhausted.value).toBe(false)
    expect(remainingLabel.value).toContain('نامحدود')
  })

  it('flags an exhausted quota', async () => {
    vi.mocked(quotaApi.getMyQuota).mockResolvedValue({
      tokenLimit: 1000,
      tokenUsed: 1000,
      tokenRemaining: 0,
      costLimit: null,
      resetAt: null,
    })

    const { loadQuota, isExhausted } = useQuota()
    await loadQuota()

    expect(isExhausted.value).toBe(true)
  })

  it('records an error when the request fails', async () => {
    vi.mocked(quotaApi.getMyQuota).mockRejectedValue(new Error('boom'))

    const { loadQuota, error, quota } = useQuota()
    await loadQuota()

    expect(error.value).toBe('boom')
    expect(quota.value).toBeNull()
  })
})

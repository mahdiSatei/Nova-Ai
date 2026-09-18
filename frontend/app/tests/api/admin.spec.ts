import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRequest = vi.fn()

vi.mock('@/api/http', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  API_BASE: '',
  buildUrl: (path: string) => path,
  tokenStore: { load: () => null },
}))

import { listAdminUsers, setUserAccessTier } from '@/api/admin'

describe('admin user access API', () => {
  beforeEach(() => {
    mockRequest.mockClear()
    mockRequest.mockResolvedValue({ items: [], total: 0 })
  })

  it('lists users with the search term and pagination', async () => {
    await listAdminUsers({ query: 'ali', limit: 20, offset: 40 })
    expect(mockRequest).toHaveBeenCalledWith('/v1/admin/users', {
      query: { query: 'ali', limit: 20, offset: 40 },
    })
  })

  it('patches the access tier', async () => {
    await setUserAccessTier('u-1', 'commercial')
    expect(mockRequest).toHaveBeenCalledWith('/v1/admin/users/u-1/access-tier', {
      method: 'PATCH',
      body: { accessTier: 'commercial' },
    })
  })
})

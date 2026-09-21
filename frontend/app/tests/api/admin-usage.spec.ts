import { describe, it, expect } from 'vitest'
import { listAdminUsage } from '../../src/api/admin'

describe('listAdminUsage', () => {
  it('is a function', () => {
    expect(typeof listAdminUsage).toBe('function')
  })
})

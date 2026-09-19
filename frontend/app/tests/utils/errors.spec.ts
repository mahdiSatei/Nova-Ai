import { describe, expect, it } from 'vitest'
import { streamErrorMessage } from '@/utils/errors'

describe('streamErrorMessage', () => {
  it('explains an entitlement rejection', () => {
    expect(streamErrorMessage('model_forbidden')).toBe('این مدل برای حساب شما در دسترس نیست.')
  })

  it('explains a protected system default', () => {
    expect(streamErrorMessage('model_is_default')).toBe(
      'این مدل پیش‌فرض سیستم است؛ ابتدا مدل پیش‌فرض دیگری انتخاب کنید.',
    )
  })

  it('explains a missing user', () => {
    expect(streamErrorMessage('user_not_found')).toBe('کاربر یافت نشد.')
  })

  it('still falls back for unknown codes', () => {
    expect(streamErrorMessage('brand_new_code', 'server text')).toBe('server text')
  })
})

describe('reasoning errors', () => {
  it('maps reasoning_unsupported to a Persian explanation', () => {
    expect(streamErrorMessage('reasoning_unsupported')).toContain('استدلال')
  })
})

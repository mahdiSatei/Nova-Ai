import { describe, it, expect } from 'vitest'
import { formatCredits } from '@/utils/credits'

describe('formatCredits', () => {
  it('keeps the wallet 4-decimal precision without rounding to zero', () => {
    expect(formatCredits(0.0004)).not.toBe('۰')
    expect(formatCredits(0.0004)).toBe('۰٫۰۰۰۴')
    expect(formatCredits(0.0008)).toBe('۰٫۰۰۰۸')
    expect(formatCredits(0.0021)).toBe('۰٫۰۰۲۱')
  })

  it('shows integer credits without trailing zeros', () => {
    expect(formatCredits(5)).toBe('۵')
    expect(formatCredits(1200)).toBe('۱٬۲۰۰')
  })

  it('formats large decimal amounts with thousands separators', () => {
    expect(formatCredits(1234.5678)).toBe('۱٬۲۳۴٫۵۶۷۸')
  })

  it('renders zero and invalid values as zero', () => {
    expect(formatCredits(0)).toBe('۰')
    expect(formatCredits(Number.NaN)).toBe('۰')
  })
})

const CREDIT_FRACTION_DIGITS = 4

/** Credits are stored at 4-decimal wallet precision; never round smaller values to zero. */
export function formatCredits(value: number | null | undefined): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return (0).toLocaleString('fa-IR')
  return amount.toLocaleString('fa-IR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: CREDIT_FRACTION_DIGITS,
  })
}

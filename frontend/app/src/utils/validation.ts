// BR-001: RFC 5322 practical shape. BR-002 (relaxed): 8..128 chars.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value: string): string | null {
  if (!value.trim()) return 'ایمیل الزامی است.'
  if (!EMAIL_RE.test(value.trim())) return 'یک ایمیل معتبر وارد کنید.'
  return null
}

export function validatePassword(value: string): string | null {
  if (!value) return 'رمز عبور الزامی است.'
  if (value.length < 8) return 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
  if (value.length > 128) return 'رمز عبور حداکثر ۱۲۸ کاراکتر است.'
  return null
}

/** تطابق با رمز عبور اصلی (برای فیلد «تکرار رمز عبور»). */
export function validatePasswordConfirm(confirm: string, password: string): string | null {
  if (!confirm) return 'تکرار رمز عبور الزامی است.'
  if (confirm !== password) return 'رمز عبور و تکرار آن یکسان نیستند.'
  return null
}

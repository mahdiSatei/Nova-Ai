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

/** ۳ تا ۲۰ کاراکتر؛ فقط حروف انگلیسی، عدد و زیرخط (هم‌قاعده با بک‌اند). */
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

export function validateUsername(value: string): string | null {
  if (!value) return 'نام کاربری الزامی است.'
  if (!USERNAME_RE.test(value.trim())) {
    return 'نام کاربری باید ۳ تا ۲۰ کاراکتر باشد و فقط حروف انگلیسی، عدد یا زیرخط داشته باشد.'
  }
  return null
}

/** ورود با ایمیل یا نام کاربری — فقط حضور و حداقل طول بررسی می‌شود. */
export function validateIdentifier(value: string): string | null {
  if (!value.trim()) return 'ایمیل یا نام کاربری الزامی است.'
  if (value.trim().length < 3) return 'حداقل ۳ کاراکتر وارد کنید.'
  return null
}

/** نام نمایشی اختیاری؛ حداکثر ۵۰ کاراکتر. */
export function validateDisplayName(value: string): string | null {
  if (value.trim().length > 50) return 'نام نمایشی حداکثر ۵۰ کاراکتر است.'
  return null
}

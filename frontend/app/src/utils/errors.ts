// نقشه‌ی کد خطای سرور → پیام فارسی.
// کدها بر اساس قرارداد OpenAPI و حالات رایج خطا هستند (BR-017: کد پایدار
// برای پشتیبانی، پیام برای کاربر). کدهای ناشناخته به سرور برمی‌گردند.
import type { ApiError } from '@/api/http'

const MESSAGES: Record<string, string> = {
  // Auth
  email_taken: 'این ایمیل قبلاً ثبت شده است.',
  invalid_credentials: 'ایمیل یا رمز عبور اشتباه است.',
  invalid_token: 'نشست شما معتبر نیست. لطفاً دوباره وارد شوید.',
  token_expired: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',

  // Validation / generic
  validation_failed: 'برخی فیلدها نامعتبر هستند.',

  // Authorization
  forbidden: 'شما اجازه دسترسی ندارید.',
  forbidden_action: 'شما اجازه انجام این عملیات را ندارید.',

  // Resources
  not_found: 'مورد درخواستی یافت نشد.',
  conflict: 'این مورد با رکورد دیگری تداخل دارد.',

  // Models / chat
  model_unavailable: 'این مدل در دسترس نیست.',
  model_forbidden: 'این مدل برای حساب شما در دسترس نیست.',
  model_is_default: 'این مدل پیش‌فرض سیستم است؛ ابتدا مدل پیش‌فرض دیگری انتخاب کنید.',
  user_not_found: 'کاربر یافت نشد.',
  model_in_use: 'این مدل در حال استفاده است و قابل حذف نیست.',
  replacement_not_available: 'مدل جایگزین معتبر نیست؛ باید یک مدل فعالِ متفاوت باشد.',
  no_default_model: 'مدل پیش‌فرضی انتخاب نشده است.',
  provider_not_configured: 'ارائه‌دهنده پیکربندی نشده است.',
  provider_unreachable: 'ارائه‌دهنده در دسترس نیست یا کلید API نامعتبر است.',
  duplicate_display_name: 'این نام نمایشی قبلاً استفاده شده است.',
  no_model_available: 'هیچ مدل فعالی برای گفتگو وجود ندارد.',

  // فاز ۶ — جایگزینی ارائه‌دهنده
  all_providers_unavailable:
    'سرویس‌دهنده‌ی مدل در حال حاضر در دسترس نیست. لطفاً چند لحظه بعد دوباره تلاش کنید.',
  provider_timeout: 'پاسخ مدل بیش از حد طول کشید. لطفاً دوباره تلاش کنید.',
  provider_rate_limited: 'سرویس‌دهنده در حال حاضر شلوغ است. لطفاً چند لحظه بعد دوباره تلاش کنید.',
  provider_error: 'مدل در میانه‌ی پاسخ‌دهی با خطا مواجه شد.',

  // Streaming / network
  network_error: 'خطا در ارتباط با سرور.',
  no_stream: 'پاسخی از سرور دریافت نشد.',
  stream_error: 'پاسخ استریمی قطع شد.',
  generation_in_progress: 'در حال حاضر یک پاسخ در حال تولید است. لطفاً صبر کنید یا آن را متوقف کنید.',
  no_active_generation: 'هیچ تولید فعالی برای متوقف کردن وجود ندارد.',

  // Retry
  message_not_found: 'پیام قابل تلاش مجدد پیدا نشد.',
  message_not_retryable: 'فقط پاسخ‌های ناموفق یا لغوشده قابل تلاش مجدد هستند.',

  // Stale conversation
  conversation_not_found: 'این گفتگو دیگر وجود ندارد (حذف شده است). می‌توانید گفتگوی جدیدی شروع کنید.',

  // فاز ۷ — جستجوی وب
  web_search_not_configured: 'جستجوی وب روی این سرور پیکربندی نشده است.',
  web_search_auth_error: 'دسترسی جستجوی وب نامعتبر است. با مدیر سیستم تماس بگیرید.',
  web_search_rate_limited: 'سرویس جستجوی وب شلوغ است. چند لحظه بعد دوباره تلاش کنید.',
  web_search_insufficient_credits: 'اعتبار جستجوی وب کافی نیست.',
  web_search_timeout: 'جستجوی وب زمان‌بر شد؛ پاسخ بدون منابع وب ادامه یافت.',
  web_search_provider_error: 'جستجوی وب در دسترس نیست؛ پاسخ بدون منابع وب ادامه یافت.',
  web_search_bad_response: 'پاسخ نامعتبر از سرویس جستجوی وب دریافت شد.',

  // فاز ۸ — استدلال
  reasoning_unsupported: 'این مدل از استدلال پشتیبانی نمی‌کند. استدلال را خاموش کنید و دوباره تلاش کنید.',
  invalid_reasoning_configuration: 'پیکربندی استدلال این مدل ناسازگار است.',
}

const FALLBACK = 'خطایی رخ داد. لطفاً دوباره تلاش کنید.'

/** پیام نمایشی برای کاربر بر اساس کد خطا. اگر کد ناشناس باشد، پیام سرور
 *  (احتمالاً انگلیسی) نمایش داده می‌شود؛ در غیر این صورت یک پیام عمومی فارسی. */
export function apiErrorMessage(err: ApiError): string {
  return MESSAGES[err.code] ?? err.message ?? FALLBACK
}

/** همان کار را برای خطاهای استریم (که ساختار ApiError ندارند) انجام می‌دهد. */
export function streamErrorMessage(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? FALLBACK
}
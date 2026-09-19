import { buildUrl, newRequestId, tokenStore, refreshTokens } from './http'

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

const ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.png', '.jpg', '.jpeg'] as const

export interface UploadedFile {
  id: string
  originalName: string
  mimeType: string
  size: number
  fileKey: string
  url: string
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  errorMessage?: string | null
  createdAt: string
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

/** تبدیل خودکار کاراکترهای به‌هم‌ریخته (Mojibake مثل Ú¯Ø²Ø§Ø±Ø´) به فارسی سالم */
export function fixPersianMojibake(str: string): string {
  if (!str) return ''
  try {
    // اگر کاراکترهای خراب لاتین در رشته بود، آن را به UTF-8 واقعی تبدیل کن
    if (/[\u00C0-\u00FF]/.test(str)) {
      const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0))
      return new TextDecoder('utf-8').decode(bytes)
    }
    return str
  } catch {
    return str
  }
}

export function validateLocalFile(file: File): void {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new FileValidationError('فقط فایل‌های PDF، اکسل (xlsx, xls) و تصویر (png, jpg, jpeg) مجاز هستند.')
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new FileValidationError('حجم فایل نباید از ۱۰ مگابایت بیشتر باشد.')
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`
  return `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`
}

async function readError(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    return { code: body.code ?? 'unknown_error', message: body.message ?? `خطای سرور (${res.status})` }
  } catch {
    return { code: 'unknown_error', message: `خطای سرور (${res.status})` }
  }
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)

  let tokens = tokenStore.load()
  let res = await fetch(buildUrl('/v1/files/upload'), {
    method: 'POST',
    headers: {
      'X-Request-ID': newRequestId(),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
    body: form,
  })

  if (res.status === 401 && tokens) {
    const refreshed = await refreshTokens()
    if (refreshed) {
      tokens = refreshed
      res = await fetch(buildUrl('/v1/files/upload'), {
        method: 'POST',
        headers: {
          'X-Request-ID': newRequestId(),
          Authorization: `Bearer ${tokens.accessToken}`,
        },
        body: form,
      })
    }
  }

  if (!res.ok) {
    const { code, message } = await readError(res)
    const err = new Error(message) as Error & { code?: string }
    err.code = code
    throw err
  }

  const data = (await res.json()) as UploadedFile
  
  // ✨ تضمین نام فارسی سالم: استفاده از نام اصلی مرورگر یا رمزگشایی متن دریافتی
  data.originalName = file.name ? file.name : fixPersianMojibake(data.originalName)

  return data
}

// به فایل frontend/app/src/api/files.ts اضافه کنید:

export interface FileStatusResponse {
  id: string
  originalName: string
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  errorMessage: string | null
}

export async function getFileStatus(fileId: string): Promise<FileStatusResponse> {
  const tokens = tokenStore.load()
  const res = await fetch(buildUrl(`/v1/files/${fileId}/status`), {
    headers: {
      'X-Request-ID': newRequestId(),
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
  })

  if (!res.ok) {
    const { code, message } = await readError(res)
    const err = new Error(message) as Error & { code?: string }
    err.code = code
    throw err
  }

  return (await res.json()) as FileStatusResponse
}
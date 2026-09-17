import { buildUrl, newRequestId, tokenStore, refreshTokens } from './http'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** پسوندها و MIMEهای مجاز — هماهنگ با اعتبارسنجی سمت سرور. */
const ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.png', '.jpg', '.jpeg'] as const

export interface UploadedFile {
  id: string
  originalName: string
  mimeType: string
  size: number
  fileKey: string
  url: string
  status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileValidationError'
  }
}

/** اعتبارسنجی سمت کاربر: اندازه ≤ 10MB و پسوند مجاز. */
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

/** فرمت خوانا برای اندازه فایل (کیلوبایت/مگابایت). */
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

/**
 * POST /v1/files/upload — multipart/form-data.
 * Unlike the shared JSON `request()` helper, FormData must NOT get an
 * explicit Content-Type header (the browser sets the multipart boundary).
 */
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
  return (await res.json()) as UploadedFile
}

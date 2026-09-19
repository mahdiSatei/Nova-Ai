// §7.8 — timestamps arrive ISO 8601 UTC (Z); for Persian-first UI we render
// in fa-IR with the Persian (Jalali) calendar and Persian numerals.
// `Intl` is built-in; no dependency needed.
const FORMATTER = new Intl.DateTimeFormat('fa-IR', {
  calendar: 'persian',
  timeZone: 'Asia/Tehran', // ✨ اجبار ساعت به وقت تهران
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'

  // If the ISO string lacks timezone information, treat it as UTC to avoid local-time misinterpretation
  const dateStr = (iso.endsWith('Z') || iso.includes('+')) ? iso : iso + 'Z'
  const d = new Date(dateStr)

  if (Number.isNaN(d.getTime())) return '—'
  return FORMATTER.format(d)
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'همین حالا'
  if (mins < 60) return `${mins} دقیقه پیش`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ساعت پیش`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} روز پیش`
  return formatDateTime(iso)
}
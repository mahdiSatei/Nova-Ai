<script setup lang="ts">
// رندر Markdown پاسخ دستیار: کد با highlight.js + دکمه کپی، جدول/فهرست/بولد.
// خروجی همیشه با DOMPurify پاک‌سازی می‌شود (متن از مدل LLM می‌آید).
// کپی از طریق delegation روی pre انجام می‌شود؛ هیچ listener یا data-attr داخل
// HTML تزریق‌شده نیست، پس سطح حمله‌ی جدیدی اضافه نمی‌شود.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Marked, type Tokens } from 'marked'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'
import { copyText } from '@/utils/clipboard'

const props = withDefaults(defineProps<{ source: string; streaming?: boolean }>(), {
  streaming: false,
})

const COPY_ICON =
  '<svg viewBox="0 0 256 256" width="12" height="12" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="132" y="132" width="88" height="88" rx="20.005" /><path d="M104 132H84a35.88 35.88 0 0 1-35.94-35.94V84A36 36 0 0 1 84 48h36.06A35.88 35.88 0 0 1 156 83.94V104" /></svg>'
const CHECK_ICON =
  '<svg viewBox="0 0 256 256" width="12" height="12" fill="none" stroke="currentColor" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="232 76 96 212 24 140" /></svg>'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function highlight(code: string, lang: string): string {
  if (lang) {
    try {
      if (hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      /* fall through to auto/plain */
    }
  }
  if (lang) {
    try {
      const auto = hljs.highlightAuto(code)
      if (auto.relevance > 0 && auto.value !== escapeHtml(code)) return auto.value
    } catch {
      /* plain fallback below */
    }
  }
  return escapeHtml(code)
}

const marked = new Marked({ breaks: true, gfm: true })
marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
      const html = highlight(text, language)
      const chip = language ? `<span class="md-lang-chip">${escapeHtml(language)}</span>` : ''
      return `<pre>${chip}<button type="button" class="md-copy-btn" aria-label="کپی کد">${COPY_ICON}<span>کپی</span></button><code class="hljs language-${escapeHtml(language)}">${html}</code></pre>`
    },
  },
})

const html = computed(() =>
  DOMPurify.sanitize(String(marked.parse(props.source ?? '', { async: false })), {
    ADD_ATTR: ['target', 'colspan', 'rowspan'],
  }),
)

const container = ref<HTMLElement | null>(null)

function onClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement | null)?.closest?.('.md-copy-btn')
  if (!btn) return
  const pre = btn.closest('pre')
  const code = pre?.querySelector('code')
  if (!code) return
  void copyText(code.textContent ?? '').then((ok) => {
    if (!ok) return
    btn.classList.add('copied')
    btn.innerHTML = `${CHECK_ICON}<span>کپی شد</span>`
    window.setTimeout(() => {
      btn.classList.remove('copied')
      btn.innerHTML = `${COPY_ICON}<span>کپی</span>`
    }, 1600)
  })
}

watch(
  container,
  (el, prev) => {
    prev?.removeEventListener('click', onClick)
    el?.addEventListener('click', onClick)
  },
  { flush: 'post' },
)

onBeforeUnmount(() => container.value?.removeEventListener('click', onClick))
</script>

<template>
  <!-- caret استریم با ::after روی آخرین فرزند بلوکی نمایش داده می‌شود -->
  <!-- eslint-disable-next-line vue/no-v-html -- DOMPurify-sanitized above -->
  <div ref="container" class="chat-md text-sm leading-relaxed" :class="{ 'md-streaming': streaming }" v-html="html" />
</template>

<style>
.chat-md.md-streaming > :last-child::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-inline-start: 2px;
  vertical-align: -0.15em;
  border-radius: 1px;
  background: var(--app-primary);
  animation: pulse-dot 1s ease-in-out infinite;
}
</style>

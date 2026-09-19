<script setup lang="ts">
// یک فرم واحد برای ورود کاربر و مدیر. نقش بعد از ورود از طریق homeFor()
// تعیین می‌شود و redirect مناسب اتفاق می‌افتد.
// BR-005: تمام خطاهای ورود با یک پیام واحد عمومی؛ کد و requestId نشان داده نمی‌شود.
import { reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { PhMoon, PhSun } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { homeFor } from '@/router'
import { validateIdentifier, validatePassword } from '@/utils/validation'
import { apiErrorMessage } from '@/utils/errors'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const { theme, toggleTheme } = useTheme()

const form = reactive({ identifier: '', password: '' })
const fieldErrors = reactive<{ identifier: string | null; password: string | null }>({
  identifier: null,
  password: null,
})
const submitError = ref<{ message: string } | null>(null)
const submitting = ref(false)

// Spec §Registration: validate field shape on blur, not per keystroke.
function onBlur(field: 'identifier' | 'password'): void {
  fieldErrors[field] =
    field === 'identifier' ? validateIdentifier(form.identifier) : validatePassword(form.password)
}

async function onSubmit(): Promise<void> {
  submitError.value = null
  fieldErrors.identifier = validateIdentifier(form.identifier)
  fieldErrors.password = validatePassword(form.password)
  if (fieldErrors.identifier || fieldErrors.password) return

  submitting.value = true
  try {
    const user = await auth.login({ identifier: form.identifier.trim(), password: form.password })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : null
    await router.push(redirect ?? homeFor(user.role))
  } catch (err) {
    if (err instanceof ApiError) {
      submitError.value = { message: apiErrorMessage(err) }
    } else {
      submitError.value = { message: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' }
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="relative flex min-h-screen items-center justify-center px-4 py-10">
    <!-- ✨ دکمه تغییر تم در گوشه بالای صفحه -->
    <div class="absolute top-4 end-4 sm:top-6 sm:end-6">
      <button
        type="button"
        class="inline-flex size-9 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-2xs transition-colors hover:bg-hover hover:text-ink focus-visible:text-ink"
        :aria-label="theme === 'light' ? 'حالت تاریک' : 'حالت روشن'"
        :title="theme === 'light' ? 'تاریک' : 'روشن'"
        @click="toggleTheme"
      >
        <PhMoon v-if="theme === 'light'" class="size-4" aria-hidden="true" />
        <PhSun v-else class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div class="w-full max-w-sm">
      <header class="mb-8 text-center">
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/15">
          <svg class="size-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12Z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <h1 class="text-2xl font-semibold">ورود</h1>
        <p class="mt-1 text-sm text-ink-muted">به حساب خود وارد شوید.</p>
      </header>

      <form novalidate class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <ErrorBanner v-if="submitError" :message="submitError.message" />

        <BaseInput
          v-model="form.identifier"
          label="ایمیل یا نام کاربری"
          type="text"
          autocomplete="username"
          dir="ltr"
          :error="fieldErrors.identifier"
          @blur="onBlur('identifier')"
        />
        <BaseInput
          v-model="form.password"
          label="رمز عبور"
          type="password"
          autocomplete="current-password"
          dir="ltr"
          :error="fieldErrors.password"
          @blur="onBlur('password')"
        />
        <BaseButton type="submit" :loading="submitting" class="mt-2 w-full">
          {{ submitting ? 'در حال ورود…' : 'ورود' }}
        </BaseButton>
      </form>

      <nav class="mt-6 text-center text-sm text-ink-muted">
        حساب ندارید؟
        <RouterLink to="/register" class="font-medium text-primary hover:text-primary-hover">ثبت‌نام</RouterLink>
      </nav>
    </div>
  </main>
</template>
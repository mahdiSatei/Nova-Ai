<script setup lang="ts">
// فرم ورود اختصاصی مدیر.
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
    const user = await auth.adminLogin({ identifier: form.identifier.trim(), password: form.password })
    if (user.role !== 'admin') {
      submitError.value = { message: 'دسترسی غیرمجاز. این پنل فقط مخصوص مدیران است.' }
      await auth.signOut()
      return
    }
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
    <!-- ✨ دکمه تغییر تم در گوشه بالای سمت چپ -->
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
        <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-accent/15">
          <svg class="size-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <h1 class="text-2xl font-semibold">ورود مدیر</h1>
        <p class="mt-1 text-sm text-ink-muted">به پنل مدیریت سیستم وارد شوید.</p>
      </header>

      <form novalidate class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <ErrorBanner v-if="submitError" :message="submitError.message" />

        <BaseInput
          v-model="form.identifier"
          label="ایمیل یا نام کاربری مدیر"
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
          {{ submitting ? 'در حال ورود…' : 'ورود به پنل مدیریت' }}
        </BaseButton>
      </form>
    </div>
  </main>
</template>
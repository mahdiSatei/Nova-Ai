<script setup lang="ts">
// یک فرم واحد برای ورود کاربر و مدیر. نقش بعد از ورود از طریق homeFor()
// تعیین می‌شود و redirect مناسب اتفاق می‌افتد.
// BR-005: تمام خطاهای ورود با یک پیام واحد عمومی؛ کد و requestId نشان داده نمی‌شود.
import { reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { homeFor } from '@/router'
import { validateEmail, validatePassword } from '@/utils/validation'
import { apiErrorMessage } from '@/utils/errors'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const fieldErrors = reactive<{ email: string | null; password: string | null }>({
  email: null,
  password: null,
})
const submitError = ref<{ message: string } | null>(null)
const submitting = ref(false)

// Spec §Registration: validate email shape on blur, not per keystroke.
function onBlur(field: 'email' | 'password'): void {
  fieldErrors[field] =
    field === 'email' ? validateEmail(form.email) : validatePassword(form.password)
}

async function onSubmit(): Promise<void> {
  submitError.value = null
  fieldErrors.email = validateEmail(form.email)
  fieldErrors.password = validatePassword(form.password)
  if (fieldErrors.email || fieldErrors.password) return

  submitting.value = true
  try {
    const user = await auth.login({ ...form })
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
  <main class="flex min-h-screen items-center justify-center px-4 py-10">
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
          v-model="form.email"
          label="ایمیل"
          type="email"
          autocomplete="email"
          dir="ltr"
          :error="fieldErrors.email"
          @blur="onBlur('email')"
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

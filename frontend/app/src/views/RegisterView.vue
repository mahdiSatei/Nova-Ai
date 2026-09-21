<script setup lang="ts">
// ثبت‌نام با سه فیلد: ایمیل، رمز عبور، تکرار رمز عبور. هر سه LTR.
// طبق BR-005 خطای email_taken در فیلد ایمیل؛ رمز عبور حفظ می‌شود.
import { reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PhMoon, PhSun } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import { ApiError } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { validateEmail, validatePassword, validatePasswordConfirm, validateUsername } from '@/utils/validation'
import { apiErrorMessage } from '@/utils/errors'

const auth = useAuthStore()
const router = useRouter()
const { theme, toggleTheme } = useTheme()

const form = reactive({ username: '', email: '', password: '', passwordConfirm: '' })
const fieldErrors = reactive<{
  username: string | null
  email: string | null
  password: string | null
  passwordConfirm: string | null
}>({ username: null, email: null, password: null, passwordConfirm: null })
const submitError = ref<{ message: string } | null>(null)
const submitting = ref(false)

function onBlur(field: 'username' | 'email' | 'password' | 'passwordConfirm'): void {
  if (field === 'username') fieldErrors.username = validateUsername(form.username)
  else if (field === 'email') fieldErrors.email = validateEmail(form.email)
  else if (field === 'password') fieldErrors.password = validatePassword(form.password)
  else fieldErrors.passwordConfirm = validatePasswordConfirm(form.passwordConfirm, form.password)
}

async function onSubmit(): Promise<void> {
  submitError.value = null
  fieldErrors.username = validateUsername(form.username)
  fieldErrors.email = validateEmail(form.email)
  fieldErrors.password = validatePassword(form.password)
  fieldErrors.passwordConfirm = validatePasswordConfirm(form.passwordConfirm, form.password)
  if (fieldErrors.username || fieldErrors.email || fieldErrors.password || fieldErrors.passwordConfirm) return

  submitting.value = true
  try {
    await auth.register({ username: form.username.trim(), email: form.email, password: form.password })
    await router.push('/chat')
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'username_taken') {
        fieldErrors.username = apiErrorMessage(err)
      } else {
        const emailErr = err.fieldErrors.email
        if (err.code === 'email_taken' || emailErr) {
          fieldErrors.email = emailErr ?? apiErrorMessage(err)
        } else if (err.code === 'validation_failed') {
          for (const [field, message] of Object.entries(err.fieldErrors)) {
            if (field === 'username' || field === 'email' || field === 'password' || field === 'passwordConfirm') {
              fieldErrors[field] = message
            }
          }
          if (!fieldErrors.username && !fieldErrors.email && !fieldErrors.password && !fieldErrors.passwordConfirm) {
            submitError.value = { message: apiErrorMessage(err) }
          }
        } else {
          submitError.value = { message: 'ساخت حساب انجام نشد. لطفاً دوباره تلاش کنید.' }
        }
      }
    } else {
      submitError.value = { message: 'ساخت حساب انجام نشد. لطفاً دوباره تلاش کنید.' }
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="app-shell-bg relative flex min-h-screen items-center justify-center px-4 py-10">
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

    <div class="surface-card w-full max-w-sm p-6 sm:p-8">
      <header class="mb-8 text-center">
        <h1 class="text-2xl font-semibold">ساخت حساب کاربری</h1>
        <p class="mt-1 text-sm text-ink-muted">در چند ثانیه با مدل‌های هوش مصنوعی گفتگو کنید.</p>
      </header>

      <form novalidate class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <ErrorBanner v-if="submitError" :message="submitError.message" />

        <BaseInput
          v-model="form.username"
          label="نام کاربری"
          type="text"
          autocomplete="username"
          dir="ltr"
          hint="۳ تا ۲۰ کاراکتر؛ فقط حروف انگلیسی، عدد یا زیرخط."
          :error="fieldErrors.username"
          @blur="onBlur('username')"
        />
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
          autocomplete="new-password"
          dir="ltr"
          hint="حداقل ۸ کاراکتر."
          :error="fieldErrors.password"
          @blur="onBlur('password')"
        />
        <BaseInput
          v-model="form.passwordConfirm"
          label="تکرار رمز عبور"
          type="password"
          autocomplete="new-password"
          dir="ltr"
          :error="fieldErrors.passwordConfirm"
          @blur="onBlur('passwordConfirm')"
        />
        <BaseButton type="submit" :loading="submitting" class="mt-2 w-full">
          {{ submitting ? 'در حال ساخت حساب…' : 'ساخت حساب' }}
        </BaseButton>
      </form>

      <nav class="mt-6 text-center text-sm text-ink-muted">
        حساب دارید؟
        <RouterLink to="/login" class="font-medium text-primary hover:text-primary-hover">ورود</RouterLink>
      </nav>
    </div>
  </main>
</template>
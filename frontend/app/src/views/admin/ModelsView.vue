<script setup lang="ts">
// کاتالوگ مدل‌ها: لیست، افزودن، ویرایش، فعال/غیرفعال، حذف.
// طبق BR-008 حذف در صورت ارجاع (پیش‌فرض یا گفتگو) با 409 رد می‌شود؛
// در این حالت دیالوگ «مهاجرت و حذف» باز می‌شود تا ارجاع‌ها اول به یک
// مدل جایگزین فعال منتقل شوند و سپس مدل قدیمی حذف شود (بدون Force Delete).
// طبق FR-034 غیرفعال‌سازی مدل پیش‌فرض، پیش‌فرض را پاک می‌کند.
import { computed, ref } from 'vue'
import { PhCheckCircle, PhListBullets, PhPlus, PhX } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import ConfirmModal from '@/components/ConfirmModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorBanner from '@/components/ui/ErrorBanner.vue'
import ModelFormModal from '@/components/admin/ModelFormModal.vue'
import ModelMigrateModal from '@/components/admin/ModelMigrateModal.vue'
import ModelTable from '@/components/admin/ModelTable.vue'
import { ApiError } from '@/api/http'
import { apiErrorMessage } from '@/utils/errors'
import { deleteModel, getConfig, listAdminModels, updateModel } from '@/api/admin'
import type { DeleteModelMigrationResult } from '@/api/admin'
import { usePagination } from '@/composables/usePagination'
import { useModelsStore } from '@/stores/models'
import type { ModelAdmin } from '@/types/api'

const page = usePagination<ModelAdmin>(listAdminModels, { limit: 50 })
const publicModels = useModelsStore()

const formOpen = ref(false)
const editing = ref<ModelAdmin | null>(null)
const toDelete = ref<ModelAdmin | null>(null)
const deleteBusy = ref(false)
const actionError = ref<ApiError | null>(null)
const defaultModelId = ref<string | null>(null)

const migrateFor = ref<ModelAdmin | null>(null)
const migrateBusy = ref(false)
const migrateError = ref<ApiError | null>(null)
const lastMigrated = ref<DeleteModelMigrationResult | null>(null)

const items = computed(() => page.items.value)
const migrateCandidates = computed(
  () => items.value.filter((m) => m.enabled && m.id !== migrateFor.value?.id),
)

async function refreshDefaultId(): Promise<void> {
  try {
    const cfg = await getConfig()
    defaultModelId.value = cfg.defaultModelId
  } catch {
    /* ignore */
  }
}
refreshDefaultId()

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openEdit(m: ModelAdmin): void {
  editing.value = m
  formOpen.value = true
}

async function onSaved(): Promise<void> {
  await page.refresh()
  await refreshDefaultId()
}

async function onToggle(m: ModelAdmin): Promise<void> {
  actionError.value = null
  try {
    const next = await updateModel(m.id, { enabled: !m.enabled })
    page.remove((it) => it.id === m.id)
    page.items.value.push(next)
    // local reorder could be improved; current order is fine.
    if (next.isDefault || next.id === defaultModelId.value) {
      await refreshDefaultId()
    }
  } catch (err) {
    if (err instanceof ApiError) actionError.value = err
  }
}

function askDelete(m: ModelAdmin): void {
  toDelete.value = m
  actionError.value = null
}

async function onConfirmDelete(): Promise<void> {
  const m = toDelete.value
  if (!m) return
  deleteBusy.value = true
  try {
    await deleteModel(m.id)
    page.remove((it) => it.id === m.id)
    toDelete.value = null
    lastMigrated.value = null
    void publicModels.load(true)
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409) {
        // مدل در حال استفاده است (model_in_use) → به‌جای نمایش خطای مبهم،
        // مسیر امن «انتخاب مدل جایگزین → انتقال ارجاع‌ها → حذف» را باز
        // می‌کنیم.
        toDelete.value = null
        migrateError.value = null
        migrateFor.value = m
      } else {
        actionError.value = err
      }
    }
  } finally {
    deleteBusy.value = false
  }
}

async function onConfirmMigrate(replacementId: string): Promise<void> {
  const m = migrateFor.value
  if (!m || !replacementId) return
  migrateBusy.value = true
  migrateError.value = null
  try {
    const result = await deleteModel(m.id, replacementId)
    if (result) lastMigrated.value = result
    await page.refresh()
    await refreshDefaultId()
    void publicModels.load(true)
    migrateFor.value = null
  } catch (err) {
    // خطا داخل خود دیالوگ نمایش داده می‌شود تا پشت overlay پنهان نماند.
    if (err instanceof ApiError) migrateError.value = err
  } finally {
    migrateBusy.value = false
  }
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center gap-3">
      <PhListBullets class="size-5 text-primary" aria-hidden="true" />
      <h1 class="text-base font-semibold">کاتالوگ مدل‌ها</h1>
      <div class="ms-auto">
        <BaseButton size="sm" @click="openCreate">
          <PhPlus class="size-4" aria-hidden="true" />
          <span>افزودن مدل</span>
        </BaseButton>
      </div>
    </header>

    <div
      v-if="lastMigrated"
      class="mb-3 flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3"
    >
      <PhCheckCircle class="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
      <p class="flex-1 text-sm text-ink">
        مدل حذف شد؛
        <span dir="ltr">{{ lastMigrated.migrated.conversations }}</span> گفتگو و
        <span dir="ltr">{{ lastMigrated.migrated.users }}</span> انتخاب کاربر به مدل جایگزین
        منتقل شد<span v-if="lastMigrated.migrated.defaultSwitched"> و مدل پیش‌فرض سیستم هم
        به‌روزرسانی شد</span>.
      </p>
      <button
        type="button"
        class="cursor-pointer rounded-md p-1 text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        aria-label="بستن پیام"
        @click="lastMigrated = null"
      >
        <PhX class="size-4" aria-hidden="true" />
      </button>
    </div>

    <ErrorBanner
      v-if="actionError"
      :message="apiErrorMessage(actionError)"
      :code="actionError.code"
      :request-id="actionError.requestId"
      :show-code="true"
      class="mb-3"
    />
    <ErrorBanner
      v-if="page.error.value"
      :message="apiErrorMessage(page.error.value)"
      :code="page.error.value.code"
      :request-id="page.error.value.requestId"
      :show-code="true"
      class="mb-3"
    />

    <div v-if="page.initialLoading.value" class="h-48 animate-pulse rounded-card bg-surface" />

    <EmptyState
      v-else-if="items.length === 0 && !page.error.value"
      title="مدلی وجود ندارد"
      description="برای شروع، اولین مدل را اضافه کنید."
    >
      <BaseButton size="sm" variant="primary" @click="openCreate">
        <PhPlus class="size-4" aria-hidden="true" />
        افزودن اولین مدل
      </BaseButton>
    </EmptyState>

    <template v-else>
      <ModelTable
        :models="items"
        :default-model-id="defaultModelId"
        @edit="openEdit"
        @toggle="onToggle"
        @remove="askDelete"
      />

      <div v-if="page.hasMore.value" class="mt-3 flex justify-center">
        <BaseButton variant="secondary" size="sm" :loading="page.loading.value" @click="page.loadMore">
          موارد بیشتر
        </BaseButton>
      </div>
    </template>

    <ModelFormModal
      :open="formOpen"
      :model="editing"
      @update:open="(v: boolean) => (formOpen = v)"
      @saved="onSaved"
    />

    <ConfirmModal
      :open="toDelete !== null"
      title="حذف مدل"
      :description="toDelete ? `مدل «${toDelete.displayName}» برای همیشه حذف می‌شود.` : ''"
      confirm-label="حذف"
      :busy="deleteBusy"
      @update:open="(v: boolean) => { if (!v) toDelete = null }"
      @confirm="onConfirmDelete"
    />

    <ModelMigrateModal
      :open="migrateFor !== null"
      :target="migrateFor"
      :candidates="migrateCandidates"
      :busy="migrateBusy"
      :error="migrateError"
      @update:open="(v: boolean) => { if (!v && !migrateBusy) migrateFor = null }"
      @confirm="onConfirmMigrate"
    />
  </section>
</template>

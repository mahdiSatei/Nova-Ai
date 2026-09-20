<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { PhX, PhChartBar } from '@phosphor-icons/vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseSpinner from '@/components/ui/BaseSpinner.vue'
import { listAdminUsage } from '@/api/admin'
import type { UsageReport } from '@/types/api'

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<UsageReport | null>(null)

// Filters
const filters = ref({
  userId: '',
  modelId: '',
  providerId: '',
  status: '',
  from: '',
  to: '',
})
const page = ref(0)
const limit = ref(20)

async function fetchData() {
  loading.value = true
  error.value = null
  try {
    data.value = await listAdminUsage({
      ...(filters.value.userId && { userId: filters.value.userId }),
      ...(filters.value.modelId && { modelId: filters.value.modelId }),
      ...(filters.value.providerId && { providerId: filters.value.providerId }),
      ...(filters.value.status && { status: filters.value.status }),
      ...(filters.value.from && { from: filters.value.from }),
      ...(filters.value.to && { to: filters.value.to }),
      limit: limit.value,
      offset: page.value * limit.value,
    })
  } catch (e: any) {
    error.value = e?.message ?? 'خطا در بارگذاری داده‌ها'
  } finally {
    loading.value = false
  }
}

function clearFilters() {
  filters.value = { userId: '', modelId: '', providerId: '', status: '', from: '', to: '' }
  page.value = 0
  fetchData()
}

function nextPage() {
  if (data.value && (page.value + 1) * limit.value < data.value.total) {
    page.value++
    fetchData()
  }
}

function prevPage() {
  if (page.value > 0) {
    page.value--
    fetchData()
  }
}

const totalPages = computed(() => {
  if (!data.value) return 0
  return Math.ceil(data.value.total / limit.value)
})

const statusOptions = [
  { value: '', label: 'همه' },
  { value: 'completed', label: 'تکمیل شده' },
  { value: 'failed', label: 'ناموفق' },
  { value: 'pending', label: 'در انتظار' },
]

function formatCost(cost: number | undefined | null): string {
  const val = Number(cost) || 0
  return val.toFixed(8)
}

function formatTokens(tokens: number | undefined | null): string {
  const val = Number(tokens) || 0
  return val.toLocaleString('fa-IR')
}

onMounted(fetchData)
watch(filters, () => { page.value = 0; fetchData() }, { deep: true })
</script>

<template>
  <div class="space-y-6 py-2">
    <div class="flex items-center gap-3">
      <PhChartBar class="size-6 text-accent" aria-hidden="true" />
      <div>
        <h1 class="text-xl font-bold">گزارش مصرف</h1>
        <p class="mt-1 text-xs text-ink-muted">مصرف توکن، هزینه و وضعیت درخواست‌های کاربران را با فیلترهای مختلف بررسی کنید.</p>
      </div>
    </div>

    <!-- Summary Cards -->
    <div v-if="data" class="grid grid-cols-3 gap-4">
      <BaseCard class="p-4 text-center">
        <div class="text-sm text-ink-muted">تعداد درخواست‌ها</div>
        <div class="text-2xl font-bold text-ink">{{ formatTokens(data.totals?.requestCount) }}</div>
      </BaseCard>
      <BaseCard class="p-4 text-center">
        <div class="text-sm text-ink-muted">کل توکن‌ها</div>
        <div class="text-2xl font-bold text-ink">{{ formatTokens(data.totals?.totalTokens) }}</div>
      </BaseCard>
      <BaseCard class="p-4 text-center">
        <div class="text-sm text-ink-muted">کل هزینه (تومان)</div>
        <div class="text-2xl font-bold text-ink">{{ formatCost(data.totals?.totalCost) }} تومان</div>
      </BaseCard>
    </div>

    <!-- Filters -->
    <BaseCard class="p-4">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <BaseInput v-model="filters.userId" placeholder="شناسه کاربر" label="شناسه کاربر" />
        <BaseInput v-model="filters.modelId" placeholder="شناسه مدل" label="شناسه مدل" />
        <BaseInput v-model="filters.providerId" placeholder="شناسه ارائه‌دهنده" label="شناسه ارائه‌دهنده" />
        <BaseSelect v-model="filters.status" :options="statusOptions" label="وضعیت" />
        <BaseInput v-model="filters.from" type="datetime-local" label="از تاریخ" />
        <BaseInput v-model="filters.to" type="datetime-local" label="تا تاریخ" />
      </div>
      <div class="mt-4 flex gap-2">
        <BaseButton variant="ghost" size="sm" @click="clearFilters">
          <PhX class="size-4" aria-hidden="true" />
          پاک کردن فیلترها
        </BaseButton>
      </div>
    </BaseCard>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center py-8">
      <BaseSpinner />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="animate-fade-slide-in rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger" role="alert">
      {{ error }}
      <button type="button" class="ms-2 font-medium underline" @click="fetchData">تلاش مجدد</button>
    </div>

    <!-- Data Table -->
    <BaseCard v-else-if="data" class="overflow-hidden p-0">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="border-b border-line bg-surface">
            <tr>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">کاربر</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">مدل</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">ارائه‌دهنده</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">ورودی</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">خروجی</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">کل</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">هزینه (تومان)</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">وضعیت</th>
              <th class="px-4 py-3 text-right font-medium text-ink-muted">تاریخ</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="item in data.items" :key="item.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 text-ink">{{ item.userId?.slice(0, 8) ?? '—' }}...</td>
              <td class="px-4 py-3 text-ink">{{ item.modelName ?? item.modelId?.slice(0, 8) ?? '—' }}</td>
              <td class="px-4 py-3 text-ink">{{ item.providerName ?? item.providerId?.slice(0, 8) ?? '—' }}</td>
              <td class="px-4 py-3 text-ink">{{ formatTokens(item.promptTokens) }}</td>
              <td class="px-4 py-3 text-ink">{{ formatTokens(item.completionTokens) }}</td>
              <td class="px-4 py-3 text-ink">{{ formatTokens(item.totalTokens) }}</td>
              <td class="px-4 py-3 text-ink">{{ formatCost(item.chargedCost) }} تومان</td>
              <td class="px-4 py-3">
                <span
                  :class="{
                    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400': item.status === 'completed',
                    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400': item.status === 'failed',
                    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400': item.status === 'pending',
                  }"
                  class="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                >
                  {{ item.status === 'completed' ? 'تکمیل' : item.status === 'failed' ? 'ناموفق' : 'در انتظار' }}
                </span>
              </td>
              <td class="px-4 py-3 text-ink-muted">{{ item.createdAt ? new Date(item.createdAt).toLocaleDateString('fa-IR') : '—' }}</td>
            </tr>
            <tr v-if="data.items.length === 0">
              <td colspan="9" class="px-4 py-8 text-center text-ink-muted">
                داده‌ای یافت نشد
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between border-t border-line px-4 py-3">
        <div class="text-sm text-ink-muted">
          صفحه {{ page + 1 }} از {{ totalPages }} ({{ data.total }} رکورد)
        </div>
        <div class="flex gap-2">
          <BaseButton variant="ghost" size="sm" :disabled="page === 0" @click="prevPage">
            قبلی
          </BaseButton>
          <BaseButton variant="ghost" size="sm" :disabled="page >= totalPages - 1" @click="nextPage">
            بعدی
          </BaseButton>
        </div>
      </div>
    </BaseCard>
  </div>
</template>
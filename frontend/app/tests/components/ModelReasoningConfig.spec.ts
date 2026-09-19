import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelTable from '@/components/admin/ModelTable.vue'
import type { ModelAdmin } from '@/types/api'

const base: ModelAdmin = {
  id: 'm1',
  displayName: 'Reasoner',
  actualName: 'some/model',
  providerId: 'p1',
  visibility: 'public',
  enabled: true,
  isDefault: false,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
}

describe('ModelTable reasoning column', () => {
  it('shows the effective capability with its source', () => {
    const wrapper = mount(ModelTable, {
      props: {
        models: [
          {
            ...base,
            reasoning: {
              mode: 'automatic',
              effective: { supported: true, output: 'summary', streaming: true, configurationSource: 'automatic' },
              discovered: {
                supported: true,
                output: 'summary',
                streaming: true,
                sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
                discoveredAt: '2026-09-19T00:00:00.000Z',
              },
              manual: { supported: null, output: null, streaming: null },
            },
          },
        ],
        defaultModelId: null,
      },
    })

    expect(wrapper.text()).toContain('استدلال')
    expect(wrapper.text()).toContain('پشتیبانی می‌شود')
    expect(wrapper.text()).toContain('خلاصه')
    expect(wrapper.text()).toContain('خودکار')
  })

  it('marks an unknown capability as unknown rather than unsupported-only', () => {
    const wrapper = mount(ModelTable, {
      props: {
        models: [
          {
            ...base,
            reasoning: {
              mode: 'automatic',
              effective: { supported: null, output: null, streaming: null, configurationSource: 'automatic' },
              discovered: {
                supported: null,
                output: null,
                streaming: null,
                sources: { supported: 'unknown', output: 'unknown', streaming: 'unknown' },
                discoveredAt: null,
              },
              manual: { supported: null, output: null, streaming: null },
            },
          },
        ],
        defaultModelId: null,
      },
    })

    expect(wrapper.text()).toContain('نامشخص')
  })
})

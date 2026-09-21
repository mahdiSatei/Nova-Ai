import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ModelFormModal from '@/components/admin/ModelFormModal.vue'
import { ApiError } from '@/api/http'
import { updateModel } from '@/api/admin'
import type { ModelAdmin } from '@/types/api'

vi.mock('@/api/admin', () => ({
  createModel: vi.fn(),
  updateModel: vi.fn(),
  discoverModelReasoning: vi.fn(),
  listProviders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}))

const modelWithUnknownReasoning: ModelAdmin = {
  id: 'm1',
  displayName: 'Model A',
  actualName: 'provider/model-a',
  providerId: 'p1',
  visibility: 'public',
  enabled: true,
  isDefault: false,
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
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
}

function mountModal(model: ModelAdmin | null) {
  // The real app mounts the modal closed and flips `open` later, so the
  // prefilled-state watcher fires. Replicate that sequence exactly.
  return mount(ModelFormModal, {
    props: { open: false, model },
    global: { stubs: { teleport: true } },
  })
}

async function openModal(wrapper: ReturnType<typeof mountModal>) {
  await wrapper.setProps({ open: true })
  await flushPromises()
}

async function submit(wrapper: ReturnType<typeof mountModal>) {
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('ModelFormModal error handling', () => {
  beforeEach(() => {
    vi.mocked(updateModel).mockReset()
  })

  it('sends a non-contradictory reasoning patch for an unknown-capability model', async () => {
    vi.mocked(updateModel).mockResolvedValue(modelWithUnknownReasoning)
    const wrapper = mountModal(modelWithUnknownReasoning)
    await openModal(wrapper)

    await submit(wrapper)

    const patch = vi.mocked(updateModel).mock.calls[0][1] as Record<string, unknown> & {
      reasoning: { supported: unknown; output: unknown; streaming: unknown }
    }
    // With supported unknown (null), output/streaming must be null too —
    // otherwise the backend rejects the whole save with 422.
    expect(patch.reasoning.supported).toBeNull()
    expect(patch.reasoning.output).toBeNull()
    expect(patch.reasoning.streaming).toBeNull()
  })

  it('displays the model_is_default rejection inside the modal', async () => {
    vi.mocked(updateModel).mockRejectedValue(
      new ApiError(409, {
        code: 'model_is_default',
        message: 'This model is the system default. Choose another default before restricting its visibility.',
        requestId: 'req-1',
      }, 'Request failed'),
    )
    const wrapper = mountModal({ ...modelWithUnknownReasoning, isDefault: true })
    await openModal(wrapper)

    await submit(wrapper)

    expect(wrapper.text()).toContain('این مدل پیش‌فرض سیستم است')
    expect(wrapper.text()).toContain('model_is_default')
  })

  it('displays the invalid_reasoning_configuration rejection inside the modal', async () => {
    vi.mocked(updateModel).mockRejectedValue(
      new ApiError(422, {
        code: 'invalid_reasoning_configuration',
        message: 'Reasoning output and streaming need an explicit "supported" value.',
        requestId: 'req-2',
      }, 'Request failed'),
    )
    const wrapper = mountModal(modelWithUnknownReasoning)
    await openModal(wrapper)

    await submit(wrapper)

    expect(wrapper.text()).toContain('پیکربندی استدلال')
    expect(wrapper.text()).toContain('invalid_reasoning_configuration')
  })

  it('sends a valid triple after live-switching to unsupported with summary output', async () => {
    const modelWithSummary: ModelAdmin = {
      ...modelWithUnknownReasoning,
      reasoning: {
        ...modelWithUnknownReasoning.reasoning!,
        manual: { supported: true, output: 'summary', streaming: true },
      },
    }
    vi.mocked(updateModel).mockResolvedValue(modelWithSummary)
    const wrapper = mountModal(modelWithSummary)
    await openModal(wrapper)

    // Manual mode first (fixture starts automatic), then switch support to
    // "unsupported" while "summary" is still selected.
    const selects = wrapper.findAll('select')
    await selects[2].setValue('manual')
    // The "supported" select appears only after the manual-mode re-render.
    const selectsAfterManual = wrapper.findAll('select')
    await selectsAfterManual[3].setValue('unsupported')
    await submit(wrapper)

    const patch = vi.mocked(updateModel).mock.calls[0][1] as Record<string, unknown> & {
      reasoning: { supported: unknown; output: unknown; streaming: unknown }
    }
    expect(patch.reasoning.supported).toBe(false)
    expect(patch.reasoning.output).toBe('none')
    expect(patch.reasoning.streaming).toBe(false)
  })
})

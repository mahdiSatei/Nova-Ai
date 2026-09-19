import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReasoningPanel from '@/components/chat/ReasoningPanel.vue'

describe('ReasoningPanel', () => {
  it('renders the summary expanded while reasoning streams', () => {
    const wrapper = mount(ReasoningPanel, {
      props: { summary: 'weighing options', streaming: true },
    })
    expect(wrapper.text()).toContain('در حال استدلال')
    expect(wrapper.text()).toContain('weighing options')
  })

  it('collapses to a summary header once the answer starts', async () => {
    const wrapper = mount(ReasoningPanel, {
      props: { summary: 'weighing options', streaming: true },
    })
    await wrapper.setProps({ streaming: false })
    expect(wrapper.text()).toContain('خلاصه استدلال')
    expect(wrapper.text()).toContain('weighing options')
  })

  it('can be expanded and collapsed by the user', async () => {
    const wrapper = mount(ReasoningPanel, {
      props: { summary: 'weighing options', streaming: false },
    })
    const toggle = wrapper.get('button')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
  })
})

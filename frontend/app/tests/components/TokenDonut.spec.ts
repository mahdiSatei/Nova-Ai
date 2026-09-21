import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TokenDonut from '@/components/usage/TokenDonut.vue'

describe('TokenDonut', () => {
  it('renders a legend entry with percentage for each token class', () => {
    const wrapper = mount(TokenDonut, {
      props: { inputTokens: 50, outputTokens: 30, reasoningTokens: 20, totalTokens: 100 },
    })
    const legend = wrapper.text()
    expect(legend).toContain('ورودی')
    expect(legend).toContain('خروجی')
    expect(legend).toContain('استدلال')
    expect(legend).toContain('۵۰٪')
    expect(legend).toContain('۳۰٪')
    expect(legend).toContain('۲۰٪')
  })

  it('shows the total token count in the center', () => {
    const wrapper = mount(TokenDonut, {
      props: { inputTokens: 50, outputTokens: 30, reasoningTokens: 20, totalTokens: 100 },
    })
    expect(wrapper.text()).toContain('۱۰۰')
  })

  it('renders one arc per non-zero segment', () => {
    const wrapper = mount(TokenDonut, {
      props: { inputTokens: 70, outputTokens: 30, reasoningTokens: 0, totalTokens: 100 },
    })
    expect(wrapper.findAll('.donut-arc')).toHaveLength(2)
  })

  it('renders a muted background ring and no arcs when total is zero', () => {
    const wrapper = mount(TokenDonut, {
      props: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    })
    expect(wrapper.findAll('.donut-arc')).toHaveLength(0)
    const ring = wrapper.find('circle')
    expect(ring.classes()).toContain('stroke-line')
    expect(wrapper.text()).toContain('۰')
  })
})

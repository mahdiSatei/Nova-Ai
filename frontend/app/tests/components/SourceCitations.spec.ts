import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SourceCitations from '@/components/chat/SourceCitations.vue'

describe('SourceCitations', () => {
  it('renders each source as an external link with its stable id', () => {
    const wrapper = mount(SourceCitations, {
      props: {
        sources: [
          { id: 'S1', title: 'First', url: 'https://a.test', snippet: 'a' },
          { id: 'S2', title: 'Second', url: 'https://b.test', snippet: 'b' },
        ],
      },
    })
    const links = wrapper.findAll('a')
    expect(links).toHaveLength(2)
    expect(links[0].attributes('href')).toBe('https://a.test')
    expect(links[0].attributes('target')).toBe('_blank')
    expect(links[0].attributes('rel')).toContain('noopener')
    expect(links[0].text()).toContain('S1')
  })

  it('renders nothing without sources', () => {
    const wrapper = mount(SourceCitations, { props: { sources: [] } })
    expect(wrapper.findAll('a')).toHaveLength(0)
  })
})

import { request } from '@/api/http'
import type { ConversationDetail, ConversationSummary, PaginatedQuery } from '@/types/api'

export interface ConversationPage {
  items: ConversationSummary[]
}

export function listConversations(query: PaginatedQuery = {}): Promise<ConversationPage> {
  return request<ConversationPage>('/v1/conversations', { query: { limit: 20, ...query } })
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/v1/conversations/${id}`)
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/v1/conversations/${id}`, { method: 'DELETE' })
}

export function setConversationPinned(id: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
  return request<{ id: string; pinned: boolean }>(`/v1/conversations/${id}/pin`, {
    method: 'PATCH',
    body: { pinned },
  })
}

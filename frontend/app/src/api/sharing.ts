import { request } from '@/api/http'
import type { CitationSource } from '@/types/api'

export interface ShareSnapshotResult {
  shareId: string
  title: string | null
  modelDisplayName: string | null
  messageCount: number
  createdAt: string
}

export interface SharedSnapshotMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  citations: CitationSource[]
  reasoningSummary: string | null
  file: { id: string; originalName: string; mimeType: string; size: number } | null
}

export interface SharedSnapshot {
  title: string | null
  modelDisplayName: string | null
  createdAt: string
  messages: SharedSnapshotMessage[]
}

export function createShareSnapshot(conversationId: string): Promise<ShareSnapshotResult> {
  return request<ShareSnapshotResult>(`/v1/conversations/${conversationId}/share`, {
    method: 'POST',
  })
}

export function getSharedSnapshot(shareId: string): Promise<SharedSnapshot> {
  return request<SharedSnapshot>(`/v1/shared/${shareId}`)
}

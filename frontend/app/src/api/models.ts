import { request } from '@/api/http'
import type { ModelList, ModelPublic } from '@/types/api'

export function listModels(): Promise<ModelList<ModelPublic>> {
  return request<ModelList<ModelPublic>>('/v1/models')
}

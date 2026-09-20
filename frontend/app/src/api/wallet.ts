import { request } from '@/api/http'
import type { PaymentHistoryList, PaymentHistoryItem } from '@/types/api'

export function getMyPayments(query: {
  status?: string
  limit?: number
  offset?: number
} = {}): Promise<PaymentHistoryList> {
  return request<PaymentHistoryList>('/v1/payments', { query: { ...query } })
}

export function getMyPayment(id: string): Promise<PaymentHistoryItem> {
  return request<PaymentHistoryItem>(`/v1/payments/${id}`)
}

export function createCreditPurchase(credits: number): Promise<{
  purchaseId: string
  paymentId: string
  credits: number
  amountToman: number
  pricePerCreditToman: number
  trackId: string
  paymentUrl: string
}> {
  return request(`/v1/credit-purchases`, { method: 'POST', body: { credits } })
}

import { IsIn, IsOptional } from 'class-validator';
import { PaymentStatus } from '../payment-status';
import { PaginationQueryDto } from './pagination-query.dto';

export const PAYMENT_STATUSES: PaymentStatus[] = [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: PaymentStatus;
}

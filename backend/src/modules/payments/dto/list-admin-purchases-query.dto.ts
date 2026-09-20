import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CreditPurchaseStatus } from '../payment-status';
import { PaginationQueryDto } from './pagination-query.dto';

export const CREDIT_PURCHASE_STATUSES: CreditPurchaseStatus[] = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export class ListAdminPurchasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(CREDIT_PURCHASE_STATUSES)
  status?: CreditPurchaseStatus;
}

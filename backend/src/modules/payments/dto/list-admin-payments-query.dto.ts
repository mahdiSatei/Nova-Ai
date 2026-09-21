import { IsOptional, IsUUID } from 'class-validator';
import { ListPaymentsQueryDto } from './list-payments-query.dto';

export class ListAdminPaymentsQueryDto extends ListPaymentsQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}

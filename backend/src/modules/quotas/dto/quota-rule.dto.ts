import { IsString, IsInt, Min, IsOptional, IsIn } from 'class-validator';

export class CreateQuotaRuleDto {
  @IsString()
  @IsIn(['free', 'commercial'])
  tier!: string;

  @IsInt()
  @Min(0)
  tokenLimit!: number;

  @IsString()
  label!: string;
}

export class UpdateQuotaRuleDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  tokenLimit?: number;

  @IsOptional()
  @IsString()
  label?: string;
}

import { IsInt, Max, Min } from 'class-validator';

export const MAX_CREDITS_PER_PURCHASE = 1_000_000;

export class CreateCreditPurchaseDto {
  /** Whole Credits: Credits are sold in units, and the price is integer Toman. */
  @IsInt()
  @Min(1)
  @Max(MAX_CREDITS_PER_PURCHASE)
  credits!: number;
}

import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Zibal promises only `trackId` and `success` on the browser callback, which is
 * exactly why neither the amount nor the Credits are read from here: the only
 * trustworthy source is a server-to-server `verify`.
 */
export class ZibalCallbackDto {
  @IsString()
  trackId!: string;

  @IsOptional()
  @IsIn(['0', '1'])
  success?: string;

  /** Some Zibal-compatible gateways also echo these fields on the callback. */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  orderId?: string;
}

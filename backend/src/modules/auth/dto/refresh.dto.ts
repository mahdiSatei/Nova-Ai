import { IsString } from 'class-validator';

export class RefreshRequestDto {
  @IsString()
  refreshToken!: string;
}

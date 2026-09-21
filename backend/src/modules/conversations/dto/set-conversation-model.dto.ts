import { IsString, IsUUID } from 'class-validator';

/**
 * Body of PATCH /v1/conversations/:id/model.
 *
 * `modelId` MUST reference an existing model; the controller re-checks
 * `model.enabled` after validation and rejects with 422 if the model
 * is missing or disabled.
 */
export class SetConversationModelDto {
  @IsString({ message: 'modelId must be a string' })
  @IsUUID('4', { message: 'modelId must be a UUID' })
  modelId!: string;
}

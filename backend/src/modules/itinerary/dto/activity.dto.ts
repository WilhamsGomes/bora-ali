import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ActivityCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsLocalTime, trim } from '../../../common/validators';
import { PLACE_PROVIDERS } from '../../locations/place';

export class ActivityInputDto {
  @ApiProperty({ example: 'Pastéis de Belém', maxLength: 200 })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: '09:30', description: 'Horário local no fuso da viagem (HH:MM)' })
  @IsLocalTime()
  time: string;

  @ApiPropertyOptional({ enum: ActivityCategory, default: ActivityCategory.outros })
  @IsOptional()
  @IsEnum(ActivityCategory)
  category?: ActivityCategory;

  @ApiPropertyOptional({ example: 'R. de Belém 84, Lisboa', maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(300)
  location?: string | null;

  @ApiPropertyOptional({ example: 60, minimum: 1, maximum: 1440, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ maxLength: 5000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({
    example: 'R. de Belém 84-92, 1300-085 Lisboa, Portugal',
    maxLength: 500,
    nullable: true,
    description: 'Endereço formatado do lugar selecionado. Descartado quando não há coordenadas.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  formattedAddress?: string | null;

  @ApiPropertyOptional({
    example: 38.6975,
    nullable: true,
    description:
      'Informe junto com longitude. Os campos do lugar formam uma unidade: enviar qualquer um substitui o lugar inteiro. ' +
      'Se o texto de `location` mudar sem campos do lugar, as coordenadas e a identificação anteriores são limpas.',
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @ApiPropertyOptional({ example: -9.2032, nullable: true, description: 'Informe junto com latitude' })
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @ApiPropertyOptional({ example: '51a7...', maxLength: 300, nullable: true, description: 'ID do lugar no provedor (exige placeProvider e coordenadas)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  placeId?: string | null;

  @ApiPropertyOptional({ enum: PLACE_PROVIDERS, nullable: true, description: 'Provedor que emitiu o placeId' })
  @IsOptional()
  @IsIn([...PLACE_PROVIDERS])
  placeProvider?: string | null;
}

export class CreateActivityDto extends ActivityInputDto {}

export class UpdateActivityDto extends PartialType(ActivityInputDto) {
  @ApiProperty({ example: 3, description: 'Versão que o cliente editou. Diferente da atual → 409 VERSION_CONFLICT' })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Move a atividade para outro dia da mesma viagem' })
  @IsOptional()
  @IsUUID()
  dayId?: string;
}

export class BatchActivityItemDto extends ActivityInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dayId: string;
}

export class BatchCreateActivitiesDto {
  @ApiProperty({ type: [BatchActivityItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BatchActivityItemDto)
  items: BatchActivityItemDto[];
}

export class ReorderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  version: number;
}

export class ReorderActivitiesDto {
  @ApiProperty({
    type: [ReorderItemDto],
    description:
      'Todas as atividades do dia na nova ordem. A ordem deve respeitar os horários; só muda o desempate entre atividades no mesmo horário.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export class DeleteActivityQueryDto {
  @ApiPropertyOptional({ description: 'Se informada, a exclusão falha com VERSION_CONFLICT quando desatualizada' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

// ───────── Respostas ─────────

export class ActivityDto extends OmitType(ActivityInputDto, ['category']) {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  tripId: string;

  @ApiProperty({ format: 'uuid' })
  dayId: string;

  @ApiProperty({ enum: ActivityCategory })
  category: ActivityCategory;

  @ApiProperty({ description: 'Desempate entre atividades no mesmo horário' })
  position: number;

  @ApiProperty()
  version: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class OverlapWarningDto {
  @ApiProperty({ example: 'TIME_OVERLAP' })
  code: 'TIME_OVERLAP';

  @ApiProperty({ format: 'uuid' })
  activityId: string;

  @ApiProperty({ format: 'uuid' })
  overlapsWithActivityId: string;

  @ApiProperty({ example: '"Museu" (10:00–12:00) se sobrepõe a "Almoço" (11:30).' })
  message: string;
}

export class ActivityMutationResultDto {
  @ApiProperty({ type: ActivityDto })
  activity: ActivityDto;

  @ApiProperty({ type: [OverlapWarningDto], description: 'Avisos informativos; não impedem o salvamento' })
  warnings: OverlapWarningDto[];
}

export class BatchCreateResultDto {
  @ApiProperty({ type: [ActivityDto] })
  activities: ActivityDto[];

  @ApiProperty({ type: [OverlapWarningDto] })
  warnings: OverlapWarningDto[];
}

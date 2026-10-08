import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { trim } from '../../../common/validators';
import { ActivityDto, OverlapWarningDto } from './activity.dto';

export class DayDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026-12-24', description: 'Data local (YYYY-MM-DD)' })
  date: string;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: [ActivityDto], description: 'Ordenadas por horário e depois por posição' })
  activities: ActivityDto[];

  @ApiProperty({ type: [OverlapWarningDto] })
  warnings: OverlapWarningDto[];

  @ApiProperty({ description: 'Ainda é possível adicionar atividades neste dia segundo o plano' })
  canAddActivities: boolean;
}

export class UpdateDayDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 120, example: 'Chegada e centro histórico' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(120)
  title?: string | null;
}

import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { TripPlan, TripRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsIanaTimeZone, IsLocalDate, trim } from '../../../common/validators';
import { DayDto } from '../../itinerary/dto/day.dto';
import { PLACE_PROVIDERS } from '../../locations/place';

/** Localização confirmada do destino (resultado escolhido na busca de destino). */
export class DestinationPlaceDto {
  @ApiProperty({ example: -8.0578 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -34.8829 })
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ type: String, example: 'Recife, Pernambuco, Brasil', maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  formattedAddress: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 300, nullable: true, description: 'Exige provider' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  placeId: string | null;

  @ApiPropertyOptional({ type: String, enum: PLACE_PROVIDERS, nullable: true })
  @IsOptional()
  @IsIn([...PLACE_PROVIDERS])
  provider: string | null;
}

export class CreateTripDto {
  @ApiProperty({ example: 'Férias em Lisboa', maxLength: 120 })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Lisboa, Portugal', maxLength: 160 })
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(160)
  destination: string;

  @ApiProperty({ example: '2026-12-20', description: 'Data local de início (YYYY-MM-DD), sem fuso' })
  @IsLocalDate()
  startDate: string;

  @ApiProperty({ example: '2026-12-27', description: 'Data local de término (YYYY-MM-DD), inclusiva' })
  @IsLocalDate()
  endDate: string;

  @ApiProperty({ example: 'Europe/Lisbon', description: 'Fuso IANA do destino' })
  @IsIanaTimeZone()
  timeZone: string;

  @ApiPropertyOptional({ example: 'Hotel Alfama', maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  stay?: string | null;

  @ApiPropertyOptional({ example: 'https://images.unsplash.com/photo-123', nullable: true })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  coverUrl?: string | null;

  @ApiPropertyOptional({
    type: DestinationPlaceDto,
    nullable: true,
    description:
      'Localização confirmada do destino. null limpa. Se `destination` mudar sem este campo, a localização anterior é limpa.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DestinationPlaceDto)
  destinationPlace?: DestinationPlaceDto | null;
}

export class UpdateTripDto extends PartialType(CreateTripDto) {
  @ApiPropertyOptional({
    type: [String],
    example: ['2026-12-27'],
    description:
      'Confirmação explícita: datas (YYYY-MM-DD) de dias com atividades que podem ser excluídos por saírem do novo período.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(366)
  @IsLocalDate({ each: true })
  confirmRemoveDates?: string[];
}

export class ListTripsQueryDto {
  @ApiPropertyOptional({ enum: ['all', 'owned', 'shared'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'owned', 'shared'])
  scope?: 'all' | 'owned' | 'shared';
}

export class TripDto extends OmitType(CreateTripDto, ['stay', 'coverUrl', 'destinationPlace']) {
  @ApiProperty({ type: DestinationPlaceDto, nullable: true, description: 'null enquanto o destino é só texto' })
  destinationPlace: DestinationPlaceDto | null;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  ownerId: string;

  @ApiProperty({ type: String, nullable: true })
  stay: string | null;

  @ApiProperty({ type: String, nullable: true })
  coverUrl: string | null;

  @ApiProperty({ enum: TripPlan })
  plan: TripPlan;

  @ApiProperty({ enum: TripRole, description: 'Papel do usuário atual nesta viagem' })
  role: TripRole;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class TripSummaryDto extends TripDto {
  @ApiProperty({ example: 8 })
  dayCount: number;

  @ApiProperty({ example: 14 })
  activityCount: number;

  @ApiProperty({ type: String, description: 'Nome do proprietário' })
  ownerName: string;

  @ApiProperty({
    description: 'false quando o usuário é convidado e o plano da viagem não permite mais colaboração',
  })
  accessible: boolean;
}

export class TripDetailDto extends TripDto {
  @ApiProperty({ type: [DayDto] })
  days: DayDto[];
}

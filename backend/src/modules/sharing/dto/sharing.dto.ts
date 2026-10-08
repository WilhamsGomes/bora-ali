import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityCategory } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateShareLinkDto {
  @ApiProperty({ description: 'Ativa ou desativa o link público' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: 'Exibir observações das atividades na visualização pública', default: false })
  @IsOptional()
  @IsBoolean()
  showNotes?: boolean;
}

export class ShareLinkDto {
  @ApiProperty({ description: 'Link configurado como ativo pelo proprietário' })
  enabled: boolean;

  @ApiProperty({ description: 'Link de fato acessível (ativo e plano com compartilhamento)' })
  active: boolean;

  @ApiProperty()
  showNotes: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'http://localhost:3000/r/2xV...' })
  url: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Token do link (para montar a URL no frontend)' })
  token: string | null;
}

export class PublicCoordinatesDto {
  @ApiProperty()
  latitude: number;

  @ApiProperty()
  longitude: number;
}

export class PublicActivityDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ example: '09:30' })
  time: string;

  @ApiProperty({ enum: ActivityCategory })
  category: ActivityCategory;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationMinutes: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'null em atividades de hospedagem' })
  formattedAddress: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null sem localização definida ou em atividades de hospedagem' })
  latitude: number | null;

  @ApiProperty({ type: Number, nullable: true })
  longitude: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Presente apenas se o proprietário permitir' })
  notes?: string | null;
}

export class PublicDayDto {
  @ApiProperty({ example: '2026-12-20' })
  date: string;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: [PublicActivityDto] })
  activities: PublicActivityDto[];
}

export class PublicTripDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  destination: string;

  @ApiProperty({ example: '2026-12-20' })
  startDate: string;

  @ApiProperty({ example: '2026-12-27' })
  endDate: string;

  @ApiProperty({ example: 'Europe/Lisbon' })
  timeZone: string;

  @ApiProperty({ type: String, nullable: true })
  coverUrl: string | null;

  @ApiProperty({ type: PublicCoordinatesDto, nullable: true, description: 'Centro do destino confirmado' })
  destinationCenter: PublicCoordinatesDto | null;

  @ApiProperty({ type: [PublicDayDto] })
  days: PublicDayDto[];
}

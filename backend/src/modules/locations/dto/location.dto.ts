import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trim } from '../../../common/validators';

export class PlaceSearchQueryDto {
  @ApiProperty({ example: 'Marco Zero', minLength: 2, maxLength: 200 })
  @IsString()
  @Transform(trim)
  @MinLength(2)
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({
    enum: ['place', 'destination'],
    default: 'place',
    description: 'place: local de atividade (OWNER/EDITOR) · destination: localização do destino da viagem (OWNER)',
  })
  @IsOptional()
  @IsIn(['place', 'destination'])
  kind?: 'place' | 'destination';

  @ApiPropertyOptional({ minimum: 1, maximum: 8, default: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  limit?: number;
}

export class PlaceSuggestionDto {
  @ApiProperty({ example: 'geoapify' })
  provider: string;

  @ApiProperty({ description: 'Identificador do lugar no provedor' })
  placeId: string;

  @ApiProperty({ example: 'Marco Zero' })
  name: string;

  @ApiProperty({ example: 'Marco Zero, Praça Rio Branco, Recife - PE, 50030-310, Brasil' })
  formattedAddress: string;

  @ApiProperty({ type: String, nullable: true, description: 'Complemento para exibição abaixo do nome' })
  secondary: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Recife' })
  city: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Pernambuco' })
  state: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Brasil' })
  country: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'BR' })
  countryCode: string | null;

  @ApiProperty({ example: -8.0631 })
  latitude: number;

  @ApiProperty({ example: -34.8711 })
  longitude: number;

  @ApiProperty({ type: String, nullable: true, example: 'amenity' })
  resultType: string | null;
}

export class PlaceSearchResultDto {
  @ApiProperty({ type: [PlaceSuggestionDto], description: 'Sugestões em ordem de relevância. Nunca escolha uma automaticamente.' })
  results: PlaceSuggestionDto[];

  @ApiProperty({ example: '© OpenStreetMap contributors · Powered by Geoapify', description: 'Atribuição a exibir junto aos resultados' })
  attribution: string;

  @ApiProperty({ description: 'true quando a busca foi orientada pela localização confirmada do destino' })
  biasedToDestination: boolean;
}

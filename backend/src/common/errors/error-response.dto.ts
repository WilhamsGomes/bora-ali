import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 'DAILY_ACTIVITY_LIMIT_REACHED', description: 'Código estável do erro' })
  code: string;

  @ApiProperty({ example: 'O plano gratuito permite até 5 atividades por dia.' })
  message: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Detalhes úteis ao cliente' })
  details?: Record<string, unknown>;

  @ApiProperty({ example: 'b3d1c6a2-...', description: 'ID da requisição (também no header X-Request-Id)' })
  requestId: string;
}

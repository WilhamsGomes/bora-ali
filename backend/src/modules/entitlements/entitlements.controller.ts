import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { ErrorResponseDto } from "../../common/errors/error-response.dto";
import { AuthUser, CurrentUser } from "../auth/auth.decorators";
import { EntitlementsDto } from "./dto/entitlements.dto";
import { EntitlementsService } from "./entitlements.service";

@ApiTags("entitlements")
@ApiBearerAuth()
@Controller("trips/:tripId/entitlements")
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Plano, limites, recursos, consumo de IA e upgrades disponíveis da viagem",
  })
  @ApiOkResponse({ type: EntitlementsDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param("tripId", ParseUUIDPipe) tripId: string,
  ): Promise<EntitlementsDto> {
    return this.entitlements.forTrip(user.id, tripId);
  }
}

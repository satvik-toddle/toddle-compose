import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { ImportFromCodaDto } from "./dto";
import { ImportFromCodaService } from "./import-from-coda.service";

// "Import from Coda" (Phase 5): overwrite the current doc's body with an in-scope Coda page.
// Editor-gated inside the service; destructive and synchronous.
@UseGuards(JwtAuthGuard)
@Controller()
export class ImportFromCodaController {
  constructor(private readonly importer: ImportFromCodaService) {}

  @Post("documents/:docId/import-from-coda")
  import(
    @CurrentUser() user: AuthUser,
    @Param("docId") docId: string,
    @Body() dto: ImportFromCodaDto,
  ) {
    return this.importer.import(user, docId, dto.scopeId, dto.url);
  }
}

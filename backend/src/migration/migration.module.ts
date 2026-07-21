import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { CodaModule } from "../coda/coda.module";
import { DocumentsModule } from "../documents/documents.module";
import { RtcModule } from "../rtc/rtc.module";
import { TokenCipher } from "./token-cipher";
import { CodaCredentialsService } from "./coda-credentials.service";
import { MigrationScopesService } from "./migration-scopes.service";
import { MigrationScopesController } from "./migration-scopes.controller";
import { MigrationJobsService } from "./migration-jobs.service";
import { MigrationJobsController } from "./migration-jobs.controller";
import { ScopeValidationService } from "./scope-validation.service";
import { MigrationWorkerService } from "./migration-worker.service";

// "Copy to Coda" — Phase 4a: token encryption, credentials, destination
// (MigrationScope) CRUD, destination-URL validation. Phase 4b: migration job
// enqueue + status/cancel/retry API. Phase 4c: the durable, fault-tolerant
// background worker (MigrationWorkerService) that executes jobs against Coda.
// RtcModule supplies RtcInternalClient (getCodaHtml). PrismaModule is global.
@Module({
  imports: [AuthModule, RealmModule, CodaModule, DocumentsModule, RtcModule],
  providers: [
    TokenCipher,
    CodaCredentialsService,
    MigrationScopesService,
    MigrationJobsService,
    ScopeValidationService,
    MigrationWorkerService,
  ],
  controllers: [MigrationScopesController, MigrationJobsController],
  // Exported for other modules to decrypt pools + validate targets.
  exports: [TokenCipher, CodaCredentialsService, ScopeValidationService],
})
export class MigrationModule {}

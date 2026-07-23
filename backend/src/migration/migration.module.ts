import { forwardRef, Module } from "@nestjs/common";
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
import { ImportFromCodaService } from "./import-from-coda.service";
import { ImportFromCodaController } from "./import-from-coda.controller";

// "Copy to Coda" — Phase 4a: token encryption, credentials, destination
// (MigrationScope) CRUD, destination-URL validation. Phase 4b: migration job
// enqueue + status/cancel/retry API. Phase 4c: the durable, fault-tolerant
// background worker (MigrationWorkerService) that executes jobs against Coda.
// RtcModule supplies RtcInternalClient (getCodaHtml). PrismaModule is global.
@Module({
  imports: [
    AuthModule,
    RealmModule,
    CodaModule,
    forwardRef(() => DocumentsModule),
    RtcModule,
  ],
  providers: [
    TokenCipher,
    CodaCredentialsService,
    MigrationScopesService,
    MigrationJobsService,
    ScopeValidationService,
    MigrationWorkerService,
    ImportFromCodaService,
  ],
  controllers: [
    MigrationScopesController,
    MigrationJobsController,
    ImportFromCodaController,
  ],
  // Exported for other modules: decrypt pools + validate targets, and (for the
  // DocumentsModule delete hook) skip/finalize migration work for deleted docs.
  exports: [
    TokenCipher,
    CodaCredentialsService,
    ScopeValidationService,
    MigrationJobsService,
    MigrationWorkerService,
  ],
})
export class MigrationModule {}

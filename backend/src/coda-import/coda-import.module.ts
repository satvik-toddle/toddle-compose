import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { MigrationModule } from "../migration/migration.module";
import { CodaModule } from "../coda/coda.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { CodaImportCredentialsService } from "./coda-import-credentials.service";
import { CodaImportCredentialsController } from "./coda-import-credentials.controller";
import { CodaImportJobsService } from "./coda-import-jobs.service";
import { CodaImportJobsController } from "./coda-import-jobs.controller";
import { CodaImportWorkerClient } from "./coda-import-worker.client";

// "Import from Coda" — the reverse of MigrationModule. Phase 4: the global,
// realm-admin managed Coda read-token pool. Phase 6 (this module): validate a Coda
// URL for the admin modal + enqueue an import job (creates the target workspace and
// a QUEUED job, then wakes the Phase 7 worker). MigrationModule supplies TokenCipher
// + coda-resolve; CodaModule supplies CodaClient; WorkspacesModule supplies
// WorkspacesService. PrismaModule is global.
@Module({
  imports: [AuthModule, RealmModule, MigrationModule, CodaModule, WorkspacesModule],
  providers: [
    CodaImportCredentialsService,
    CodaImportJobsService,
    CodaImportWorkerClient,
  ],
  controllers: [CodaImportCredentialsController, CodaImportJobsController],
  // Exported so the import planner/worker can decrypt the pool via getTokenPool.
  exports: [CodaImportCredentialsService],
})
export class CodaImportModule {}

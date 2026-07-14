import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { NoAccessTokenGuard } from "../auth/no-access-token.guard";
import { PersonalAccessTokensService } from "./personal-access-tokens.service";
import { PersonalAccessTokensController } from "./personal-access-tokens.controller";

@Module({
  imports: [AuthModule, RealmModule],
  providers: [PersonalAccessTokensService, NoAccessTokenGuard],
  controllers: [PersonalAccessTokensController],
})
export class PersonalAccessTokensModule {}

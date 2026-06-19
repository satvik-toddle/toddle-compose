import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealmModule } from "../realm/realm.module";
import { NoAccessTokenGuard } from "../auth/no-access-token.guard";
import { AccessTokensService } from "./access-tokens.service";
import { AccessTokensController } from "./access-tokens.controller";

@Module({
  imports: [AuthModule, RealmModule],
  providers: [AccessTokensService, NoAccessTokenGuard],
  controllers: [AccessTokensController],
})
export class AccessTokensModule {}

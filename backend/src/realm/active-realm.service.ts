import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import type { Env } from "../config/env";

/**
 * Pins this backend instance to exactly one realm (REALM_ID). Every realm/workspace
 * query scopes to `id`. Boot fails fast if the realm row is missing — run the seed.
 */
@Injectable()
export class ActiveRealmService implements OnModuleInit {
  private readonly logger = new Logger(ActiveRealmService.name);
  private realmId!: string;
  private realmName!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>
  ) {}

  async onModuleInit(): Promise<void> {
    const id = this.config.get("REALM_ID", { infer: true });
    const realm = await this.prisma.realm.findUnique({ where: { id } });
    if (!realm) {
      throw new Error(
        `Realm "${id}" (REALM_ID) does not exist. Run \`pnpm db:seed\` to create it.`
      );
    }
    this.realmId = realm.id;
    this.realmName = realm.name;
    this.logger.log(`Pinned to realm "${realm.name}" (${realm.id})`);
  }

  get id(): string {
    return this.realmId;
  }

  get name(): string {
    return this.realmName;
  }
}

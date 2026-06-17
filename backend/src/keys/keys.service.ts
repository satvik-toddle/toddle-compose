import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import {
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
  importPKCS8,
  importSPKI,
  exportJWK,
  type KeyLike,
  type JWK,
} from "jose";
import type { Env } from "../config/env";

const ALG = "RS256";
const KID = "rtc-key-1";

type KeyMaterial = { privateKey: KeyLike; publicKey: KeyLike; publicJwk: JWK };

// RS256 keypair: private key signs RTC tokens, public JWK is served at /.well-known/rtc-jwks.json. Persisted (once) under repo-root .keys/.
@Injectable()
export class KeysService {
  readonly alg = ALG;
  readonly kid = KID;
  private cached: KeyMaterial | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  private repoRoot(): string {
    return resolve(process.cwd(), "..");
  }

  private privPath(): string {
    return resolve(
      this.repoRoot(),
      this.config.get("RTC_PRIVATE_KEY_PATH", { infer: true })
    );
  }

  private pubPath(): string {
    return resolve(
      this.repoRoot(),
      this.config.get("RTC_PUBLIC_KEY_PATH", { infer: true })
    );
  }

  async getKeys(): Promise<KeyMaterial> {
    if (this.cached) return this.cached;
    const priv = this.privPath();
    const pub = this.pubPath();

    if (existsSync(priv) && existsSync(pub)) {
      const privateKey = await importPKCS8(readFileSync(priv, "utf8"), ALG);
      const publicKey = await importSPKI(readFileSync(pub, "utf8"), ALG);
      this.cached = await this.material(privateKey, publicKey);
      return this.cached;
    }

    const { privateKey, publicKey } = await generateKeyPair(ALG, {
      modulusLength: 2048,
    });
    mkdirSync(dirname(priv), { recursive: true });
    writeFileSync(priv, await exportPKCS8(privateKey));
    writeFileSync(pub, await exportSPKI(publicKey));
    this.cached = await this.material(privateKey, publicKey);
    return this.cached;
  }

  private async material(
    privateKey: KeyLike,
    publicKey: KeyLike
  ): Promise<KeyMaterial> {
    const publicJwk = (await exportJWK(publicKey)) as JWK;
    publicJwk.kid = KID;
    publicJwk.alg = ALG;
    publicJwk.use = "sig";
    return { privateKey, publicKey, publicJwk };
  }
}

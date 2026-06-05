import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import type { Env } from "../config/env";
import { isSafeKey, OBJECT_STORAGE, type ObjectStorage } from "./object-storage";

/** The shape multer hands us (we don't depend on @types/multer just for this). */
type UploadedFileLike = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

// Read at module load (decorator-time) so the multer interceptor can hard-cap
// the stream; the handler re-checks for a clean error message.
const MAX_UPLOAD_BYTES =
  (Number(process.env.STORAGE_MAX_UPLOAD_MB) || 25) * 1024 * 1024;

@Controller("uploads")
export class UploadsController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly config: ConfigService<Env, true>
  ) {}

  /** Upload a single file (multipart field "file"). Auth required. */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } })
  )
  async upload(
    @CurrentUser() _user: AuthUser,
    @UploadedFile() file?: UploadedFileLike
  ) {
    if (!file) throw new BadRequestException('no file uploaded (field "file")');
    const max = this.config.get("STORAGE_MAX_UPLOAD_MB", { infer: true });
    if (file.size > max * 1024 * 1024) {
      throw new PayloadTooLargeException(`file exceeds ${max} MB limit`);
    }
    return this.storage.put({
      filename: file.originalname,
      contentType: file.mimetype || "application/octet-stream",
      body: file.buffer,
    });
  }

  /**
   * Serve an object by key. Public (no auth) so it can back <img src>/downloads;
   * keys are unguessable UUIDs. For the s3 driver, prefer the absolute URL from
   * the upload response (public/CDN or pre-signed) — this route still proxies it.
   */
  @Get(":key")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  async serve(@Param("key") key: string) {
    if (!isSafeKey(key)) throw new NotFoundException();
    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundException();
    return new StreamableFile(obj.body, { type: obj.contentType });
  }
}

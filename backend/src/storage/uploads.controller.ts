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

// Read at decorator-time so the multer interceptor can hard-cap the stream.
const MAX_UPLOAD_BYTES =
  (Number(process.env.STORAGE_MAX_UPLOAD_MB) || 25) * 1024 * 1024;

// Browser-executable mimetypes; stored as octet-stream so no driver serves a dangerous ContentType.
const ACTIVE_CONTENT_RE = /html|svg|xml|javascript|ecmascript/i;

// Types safe to render inline; everything else is served as a download to block stored-XSS.
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "video/mp4",
  "audio/mpeg",
]);

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
    // Sanitize the stored content type: anything browser-executable is downgraded.
    const claimed = file.mimetype || "application/octet-stream";
    const contentType = ACTIVE_CONTENT_RE.test(claimed)
      ? "application/octet-stream"
      : claimed;
    return this.storage.put({
      filename: file.originalname,
      contentType,
      body: file.buffer,
    });
  }

  // Serve an object by key. Public (no auth) so it can back <img src>/downloads; keys are unguessable.
  @Get(":key")
  @Header("Cache-Control", "public, max-age=31536000, immutable")
  @Header("X-Content-Type-Options", "nosniff")
  async serve(@Param("key") key: string) {
    if (!isSafeKey(key)) throw new NotFoundException();
    const obj = await this.storage.get(key);
    if (!obj) throw new NotFoundException();
    // Only the passive allowlist renders inline; everything else is forced to download.
    const disposition = INLINE_SAFE_TYPES.has(obj.contentType)
      ? "inline"
      : "attachment";
    return new StreamableFile(obj.body, { type: obj.contentType, disposition });
  }
}

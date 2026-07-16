import { Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { DocumentShareLinksService } from "./document-share-links.service";

// Public, UNGUARDED endpoints — the link token is the credential. REALM-scope links
// re-check auth inside the service; ANYONE-scope links work with no token at all.
@Controller("share-links")
export class ShareLinksController {
  constructor(private readonly shareLinks: DocumentShareLinksService) {}

  @Get(":token")
  resolve(@Param("token") token: string, @Headers("authorization") auth?: string) {
    return this.shareLinks.resolve(token, auth);
  }

  @Post(":token/rtc-token")
  rtcToken(@Param("token") token: string, @Headers("authorization") auth?: string) {
    return this.shareLinks.mintRtcToken(token, auth);
  }
}

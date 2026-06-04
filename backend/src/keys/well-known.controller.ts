import { Controller, Get } from "@nestjs/common";
import { KeysService } from "./keys.service";

@Controller(".well-known")
export class WellKnownController {
  constructor(private readonly keys: KeysService) {}

  @Get("rtc-jwks.json")
  async jwks() {
    const { publicJwk } = await this.keys.getKeys();
    return { keys: [publicJwk] };
  }
}

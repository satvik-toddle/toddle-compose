import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";
import { currentTokenAuth } from "./request-context";

@Injectable()
export class NoAccessTokenGuard implements CanActivate {
  canActivate(): boolean {
    if (currentTokenAuth() !== null) {
      throw new ForbiddenException("access tokens cannot manage access tokens");
    }
    return true;
  }
}

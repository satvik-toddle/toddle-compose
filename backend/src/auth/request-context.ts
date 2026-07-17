import { AsyncLocalStorage } from "async_hooks";
import { Injectable, NestMiddleware } from "@nestjs/common";
import type {
  PersonalAccessTokenPermission,
  PersonalAccessTokenScope,
} from "@app/database";

export type TokenAuthContext = {
  scope: PersonalAccessTokenScope;
  workspaceId: string | null;
  permission: PersonalAccessTokenPermission;
};

type Store = { tokenAuth: TokenAuthContext | null };

const als = new AsyncLocalStorage<Store>();

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    als.run({ tokenAuth: null }, () => next());
  }
}

export function setTokenAuth(tokenAuth: TokenAuthContext | null): void {
  const store = als.getStore();
  if (store) store.tokenAuth = tokenAuth;
}

export function currentTokenAuth(): TokenAuthContext | null {
  return als.getStore()?.tokenAuth ?? null;
}

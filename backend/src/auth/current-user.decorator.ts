import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  color: string;
  // Present when the session has "entered" a workspace; null otherwise.
  activeWorkspaceId: string | null;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  }
);

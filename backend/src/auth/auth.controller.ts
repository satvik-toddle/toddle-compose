import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { rateLimit } from "../config/rate-limit";
import { AuthService } from "./auth.service";
import { LoginDto, RefreshDto, RegisterDto } from "./dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser, AuthUser } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Unauthenticated entry points rate-limited per client IP to blunt credential stuffing.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authRegister, ttl: rateLimit.ttlMs } })
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.name);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authLogin, ttl: rateLimit.ttlMs } })
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authRefresh, ttl: rateLimit.ttlMs } })
  @Post("refresh")
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post("logout")
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }
}

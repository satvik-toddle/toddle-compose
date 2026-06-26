import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { rateLimit } from "../config/rate-limit";
import { AuthService } from "./auth.service";
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from "./dto";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser, AuthUser } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Public client config: which email-dependent flows are available on this deployment.
  @Get("config")
  config() {
    return this.auth.publicConfig();
  }

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

  // Consume the link from the verification email. 200 on success; 4xx (with a
  // body) on an invalid/expired/used token so the UI can show "request declined".
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authLogin, ttl: rateLimit.ttlMs } })
  @HttpCode(200)
  @Post("verify-email")
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  // Re-send the verification link (e.g. the first email expired or was missed).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authRegister, ttl: rateLimit.ttlMs } })
  @HttpCode(200)
  @Post("resend-verification")
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  // "Forgot password": always 200 with a generic body so it never reveals
  // whether the address has an account.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authRegister, ttl: rateLimit.ttlMs } })
  @HttpCode(200)
  @Post("forgot-password")
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  // Consume the reset link and set a new password. 200 on success; 4xx on an
  // invalid/expired/used token.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: rateLimit.authLogin, ttl: rateLimit.ttlMs } })
  @HttpCode(200)
  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
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

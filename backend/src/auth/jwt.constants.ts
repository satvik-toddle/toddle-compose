// Pinned claims for the backend's HS256 access JWTs (mirrors the RTC token's
// RTC_TOKEN_ISS / RTC_TOKEN_AUD pattern). Verification rejects tokens minted by
// or for anything else — and pins the algorithm so an attacker can't downgrade.
export const JWT_ISSUER = "compose-backend";
export const JWT_AUDIENCE = "compose-api";
export const JWT_ALGORITHM = "HS256" as const;

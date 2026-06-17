// Pinned claims for the backend's HS256 access JWTs; verification rejects anything else and prevents algorithm downgrade.
export const JWT_ISSUER = "compose-backend";
export const JWT_AUDIENCE = "compose-api";
export const JWT_ALGORITHM = "HS256" as const;

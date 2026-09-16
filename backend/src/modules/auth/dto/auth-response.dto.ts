/**
 * Response shape for register, login, and refresh. Mirrors
 * `AuthResponse` in api-contract.md §4.
 */
export class AuthResponseDto {
  user!: {
    id: string;
    email: string;
    /** Null for legacy accounts created before usernames existed. */
    username: string | null;
    /** Profile display name; null when unset. */
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: string;
    lastLoginAt: string | null;
  };
  accessToken!: string;
  refreshToken!: string;
  /** Access token TTL in seconds. */
  expiresIn!: number;
}

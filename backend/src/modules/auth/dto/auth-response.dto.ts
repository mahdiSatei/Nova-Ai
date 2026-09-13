/**
 * Response shape for register, login, and refresh. Mirrors
 * `AuthResponse` in api-contract.md §4.
 */
export class AuthResponseDto {
  user!: {
    id: string;
    email: string;
    role: 'user' | 'admin';
    createdAt: string;
    lastLoginAt: string | null;
  };
  accessToken!: string;
  refreshToken!: string;
  /** Access token TTL in seconds. */
  expiresIn!: number;
}

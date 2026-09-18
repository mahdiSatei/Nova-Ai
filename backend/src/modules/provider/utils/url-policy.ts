/**
 * URL validation policy for provider base URLs.
 *
 * Rules:
 *   - Must use http or https.
 *   - HTTPS is required in production.
 *   - HTTP is allowed only in development/test.
 *   - Private/internal IPs are blocked in production (SSRF protection).
 *   - Localhost / 127.0.0.1 is always allowed.
 */

/** Allowed hostnames in development for local provider instances. */
const DEV_ALLOWED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

/** Private/internal IP patterns blocked in production. */
const PRIVATE_IP_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00::/,
  /^fe80::/,
];

export interface UrlPolicyResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateProviderUrl(rawUrl: string, nodeEnv: string): UrlPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL format.' };
  }

  const protocol = parsed.protocol.replace(':', '');
  if (protocol !== 'http' && protocol !== 'https') {
    return { ok: false, reason: 'URL must use http or https.' };
  }

  const isProduction = nodeEnv === 'production';
  const hostname = parsed.hostname.toLowerCase();

  // Always allow localhost in any environment.
  if (DEV_ALLOWED_HOSTS.has(hostname)) {
    return { ok: true };
  }

  if (isProduction && protocol !== 'https') {
    return { ok: false, reason: 'HTTPS is required for provider URLs in production.' };
  }

  // Block private IPs in production.
  if (isProduction) {
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { ok: false, reason: 'Private/internal IPs are not allowed in production.' };
      }
    }
  }

  return { ok: true };
}

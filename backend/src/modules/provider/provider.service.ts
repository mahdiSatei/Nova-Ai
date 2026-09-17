import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CentralProvider } from './entities/central-provider.entity';
import { decrypt, encrypt } from '../../common/crypto/credential-cipher';

export interface CentralProviderPublic {
  baseUrl: string;
  apiKeyMasked: string;
  isConfigured: true;
  lastValidatedAt: string | null;
}

export interface CentralProviderUnconfigured {
  isConfigured: false;
}

/**
 * Business logic for the central-provider singleton row.
 *
 * The credential is encrypted at rest with AES-256-GCM and never
 * returned in cleartext. `GET` returns a masked form (last 4 chars
 * prefixed `***`); `PUT` validates the credential against the provider
 * with a minimal non-streaming call BEFORE persisting.
 */
@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    @InjectRepository(CentralProvider)
    private readonly repo: Repository<CentralProvider>,
  ) {}

  async read(): Promise<CentralProviderPublic | CentralProviderUnconfigured> {
    const row = await this.repo.findOne({ where: { id: 'singleton' } });
    if (!row) return { isConfigured: false };

    let plain: string;
    try {
      plain = decrypt(row.apiKeyEncrypted);
    } catch {
      this.logger.warn('Failed to decrypt stored provider credential — the encryption key may have changed');
      throw new UnprocessableEntityException({
        code: 'provider_credential_corrupt',
        message:
          'The stored provider credential cannot be decrypted. This usually means the encryption key was changed after the provider was configured. Re-enter the API key to fix this.',
      });
    }
    return {
      baseUrl: row.baseUrl,
      apiKeyMasked: this.mask(plain),
      isConfigured: true,
      lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    };
  }

  async readOrThrow(): Promise<CentralProviderPublic> {
    const result = await this.read();
    if (!result.isConfigured) {
      throw new NotFoundException({
        code: 'not_found',
        message: 'Central provider is not configured.',
      });
    }
    return result;
  }

  async update(input: { baseUrl: string; apiKey: string }): Promise<CentralProviderPublic> {
    // Probe FIRST so we never persist invalid credentials.
    await this.probe(input.baseUrl, input.apiKey);

    const encrypted = encrypt(input.apiKey);
    const existing = await this.repo.findOne({ where: { id: 'singleton' } });

    const nextValidatedAt = new Date();
    if (existing) {
      existing.baseUrl = input.baseUrl;
      existing.apiKeyEncrypted = encrypted;
      existing.lastValidatedAt = nextValidatedAt;
      await this.repo.save(existing);
    } else {
      await this.repo.save(
        this.repo.create({
          id: 'singleton',
          baseUrl: input.baseUrl,
          apiKeyEncrypted: encrypted,
          lastValidatedAt: nextValidatedAt,
        }),
      );
    }

    const plain = decrypt(encrypted);
    return {
      baseUrl: input.baseUrl,
      apiKeyMasked: this.mask(plain),
      isConfigured: true,
      lastValidatedAt: nextValidatedAt.toISOString(),
    };
  }

  async getDecryptedApiKey(): Promise<{ baseUrl: string; apiKey: string }> {
    const row = await this.repo.findOne({ where: { id: 'singleton' } });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'provider_not_configured',
        message: 'Central provider is not configured.',
      });
    }
    try {
      return {
        baseUrl: row.baseUrl,
        apiKey: decrypt(row.apiKeyEncrypted),
      };
    } catch {
      this.logger.warn('Failed to decrypt stored provider credential in getDecryptedApiKey');
      throw new UnprocessableEntityException({
        code: 'provider_credential_corrupt',
        message:
          'The stored provider credential cannot be decrypted. Re-configure the provider with a valid API key.',
      });
    }
  }

  /**
   * Validate the credential by calling a minimal, auth-only probe.
   *
   * Step 1: GET `{baseUrl}/models` with `Authorization: Bearer ...`. Every
   * mainstream OpenAI-compatible provider (OpenAI, Together, Groq,
   * OpenRouter, LM Studio, Ollama's OpenAI shim, vLLM) supports this
   * endpoint and it depends only on the auth header — no real model call
   * needed. This avoids the prior bug where the probe POSTed with
   * `model: 'probe'`, which real providers reject with HTTP 400 ("model
   * not found") BEFORE checking auth, and the probe then mis-classified
   * the 400 as `credentials_rejected`.
   *
   * Step 2: fall back to a tiny chat-completions probe ONLY if `/models`
   * returns 404/405 (a few self-hosted setups don't expose it). Status
   * is discriminated: 401/403 → real `credentials_rejected`; other 4xx →
   * new `provider_request_invalid` (credentials appear valid, but the
   * provider's response was unexpected); 5xx/network → `provider_unreachable`.
   */
  private async probe(baseUrl: string, apiKey: string): Promise<void> {
    const root = baseUrl.replace(/\/+$/, '');
    const authHeaders = { Authorization: `Bearer ${apiKey}` };

    // ── Step 1: GET /models (auth-only validation) ─────────────────────
    let modelsRes: Response;
    try {
      modelsRes = await fetch(`${root}/models`, {
        method: 'GET',
        headers: authHeaders,
      });
    } catch (err) {
      this.logger.warn(`Provider probe failed (network): ${(err as Error).message}`);
      throw new UnprocessableEntityException({
        code: 'provider_unreachable',
        message: 'The AI provider could not be reached. Check the base URL and try again.',
      });
    }

    if (modelsRes.ok) {
      return; // credentials accepted
    }

    const modelsStatus = modelsRes.status;
    if (modelsStatus === 401 || modelsStatus === 403) {
      this.logger.warn(`Provider probe failed (status=${modelsStatus}): credentials rejected`);
      throw new UnprocessableEntityException({
        code: 'credentials_rejected',
        message: `The AI provider rejected the credentials (HTTP ${modelsStatus}).`,
      });
    }

    // 404/405 → /models isn't exposed by this provider. Fall through to
    // the chat-completions probe. Anything else (5xx, other 4xx) is
    // treated as unreachable.
    if (modelsStatus !== 404 && modelsStatus !== 405) {
      let detail = '';
      try {
        detail = (await modelsRes.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      this.logger.warn(`Provider probe failed (status=${modelsStatus}): ${detail}`);
      throw new UnprocessableEntityException({
        code: 'provider_unreachable',
        message: `The AI provider returned an unexpected status (HTTP ${modelsStatus}).`,
      });
    }

    // ── Step 2: fallback probe via POST /chat/completions ──────────────
    let chatRes: Response;
    try {
      chatRes = await fetch(`${root}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          model: 'probe',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
    } catch (err) {
      this.logger.warn(
        `Provider probe failed (network, models=${modelsStatus}, chat=network): ${(err as Error).message}`,
      );
      throw new UnprocessableEntityException({
        code: 'provider_unreachable',
        message: 'The AI provider could not be reached. Check the base URL and try again.',
      });
    }

    if (chatRes.ok) {
      return;
    }

    const chatStatus = chatRes.status;
    let detail = '';
    try {
      detail = (await chatRes.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    this.logger.warn(
      `Provider probe failed (status=${chatStatus}, models=${modelsStatus}): ${detail}`,
    );

    if (chatStatus === 401 || chatStatus === 403) {
      throw new UnprocessableEntityException({
        code: 'credentials_rejected',
        message: `The AI provider rejected the credentials (HTTP ${chatStatus}).`,
      });
    }
    if (chatStatus >= 500) {
      throw new UnprocessableEntityException({
        code: 'provider_unreachable',
        message: `The AI provider returned an unexpected status (HTTP ${chatStatus}).`,
      });
    }

    // 400/404/etc — credentials appear valid (we got past auth on /models
    // being reachable, and the provider still responded) but the test
    // request itself was rejected. Don't falsely report this as a
    // credentials failure.
    throw new UnprocessableEntityException({
      code: 'provider_request_invalid',
      message: `The AI provider rejected the probe request (HTTP ${chatStatus}). The credentials appear valid but the provider's response to a test request was unexpected. Confirm the base URL points at the provider you intend.`,
    });
  }

  private mask(plain: string): string {
    if (plain.length <= 4) return '***';
    return `***${plain.slice(-4)}`;
  }
}

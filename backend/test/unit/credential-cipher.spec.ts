import * as cipher from '../../src/common/crypto/credential-cipher';

describe('CredentialCipher', () => {
  const TEST_KEY = Buffer.alloc(32, 0x42).toString('base64');

  beforeEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.PROVIDER_ENCRYPTION_KEY;
  });

  it('encrypt then decrypt round-trips the plaintext', () => {
    const secret = 'sk-my-super-secret-api-key-12345';
    const encrypted = cipher.encrypt(secret);
    const decrypted = cipher.decrypt(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const encrypted1 = cipher.encrypt('same-secret');
    const encrypted2 = cipher.encrypt('same-secret');
    expect(encrypted1).not.toBe(encrypted2);
    expect(cipher.decrypt(encrypted1)).toBe('same-secret');
    expect(cipher.decrypt(encrypted2)).toBe('same-secret');
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = cipher.encrypt('secret');
    const tampered = encrypted.replace('"ciphertext":"', '"ciphertext":"X');
    expect(() => cipher.decrypt(tampered)).toThrow('Corrupt encrypted credential');
  });

  it('throws on garbage input', () => {
    expect(() => cipher.decrypt('not-json')).toThrow('Corrupt encrypted credential');
  });

  it('throws if PROVIDER_ENCRYPTION_KEY is missing', () => {
    const prev = process.env.PROVIDER_ENCRYPTION_KEY;
    delete process.env.PROVIDER_ENCRYPTION_KEY;
    jest.isolateModules(() => {
      const fresh = require('../../src/common/crypto/credential-cipher');
      expect(() => fresh.encrypt('test')).toThrow('PROVIDER_ENCRYPTION_KEY is not set');
    });
    if (prev) process.env.PROVIDER_ENCRYPTION_KEY = prev;
  });

  it('throws if PROVIDER_ENCRYPTION_KEY has wrong length', () => {
    const prev = process.env.PROVIDER_ENCRYPTION_KEY;
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(16, 0x42).toString('base64');
    jest.isolateModules(() => {
      const fresh = require('../../src/common/crypto/credential-cipher');
      expect(() => fresh.encrypt('test')).toThrow('PROVIDER_ENCRYPTION_KEY must be 32 bytes');
    });
    if (prev) process.env.PROVIDER_ENCRYPTION_KEY = prev;
  });
});

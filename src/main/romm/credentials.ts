import { existsSync, readFileSync, rmSync } from 'node:fs';
import { z } from 'zod';
import { writeFileAtomicSync } from '../fs/atomic';
import type { TokenSet, TokenStore } from './auth';

/** OS-backed encryption (Electron safeStorage: DPAPI, Keychain or libsecret). */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

const storedCredentialsSchema = z.object({
  serverUrl: z.string(),
  tokens: z.object({
    accessToken: z.string(),
    accessExpiresAt: z.number(),
    refreshToken: z.string().nullable(),
    refreshExpiresAt: z.number().nullable(),
  }),
});

/**
 * Persists the token pair, encrypted by the OS and bound to the server it was issued by.
 * The password itself is never stored. Without OS encryption nothing is written and the
 * session lives in memory until the app exits.
 */
export class CredentialStore {
  private inMemory: { serverUrl: string; tokens: TokenSet } | null = null;

  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor,
  ) {}

  get canPersist(): boolean {
    return this.encryptor.isAvailable();
  }

  forServer(serverUrl: string): TokenStore {
    return {
      load: () => this.load(serverUrl),
      save: (tokens) => this.save(serverUrl, tokens),
      clear: () => this.clear(),
    };
  }

  private load(serverUrl: string): TokenSet | null {
    if (this.inMemory?.serverUrl === serverUrl) return this.inMemory.tokens;
    if (!this.canPersist || !existsSync(this.filePath)) return null;

    try {
      const json: unknown = JSON.parse(this.encryptor.decrypt(readFileSync(this.filePath)));
      const stored = storedCredentialsSchema.parse(json);
      return stored.serverUrl === serverUrl ? stored.tokens : null;
    } catch {
      // Undecryptable (e.g. copied from another Windows account) or corrupt: log in again.
      return null;
    }
  }

  private save(serverUrl: string, tokens: TokenSet): void {
    this.inMemory = { serverUrl, tokens };
    if (!this.canPersist) return;
    writeFileAtomicSync(this.filePath, this.encryptor.encrypt(JSON.stringify(this.inMemory)));
  }

  private clear(): void {
    this.inMemory = null;
    rmSync(this.filePath, { force: true });
  }
}

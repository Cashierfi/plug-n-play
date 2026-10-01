import { describe, it, expect, beforeEach, vi } from 'vitest';

// @icp-sdk/auth v7: AuthClient is a synchronous constructor (no static `create()`),
// and login is promise-based via `signIn()` (no onSuccess/onError callbacks).
// Mock the module so `new AuthClient(...)` returns a controllable instance.
const { mockInstance } = vi.hoisted(() => ({
  mockInstance: {
    isAuthenticated: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    getIdentity: vi.fn(),
    idleManager: { registerCallback: vi.fn() },
  },
}));

vi.mock('@icp-sdk/auth/client', () => ({
  // Regular function so `new AuthClient()` returns the mock instance.
  AuthClient: vi.fn(function () { return mockInstance; }),
}));

import { IIAdapter } from '../src/adapters/ic/IIAdapter';
import { AuthClient } from '@icp-sdk/auth/client';

// Basic mock config
const mockConfig: any = {
  hostUrl: 'http://localhost:4943',
  verifyQuerySignatures: false,
  fetchRootKey: false,
};

describe('IIAdapter', () => {
  let adapter: IIAdapter;

  beforeEach(() => {
    vi.mocked(AuthClient).mockClear();
    mockInstance.isAuthenticated.mockReset().mockReturnValue(false);
    mockInstance.signIn.mockReset();
    mockInstance.getIdentity.mockReset();
    mockInstance.signOut.mockReset().mockResolvedValue(undefined);
    mockInstance.idleManager.registerCallback.mockClear();

    adapter = new IIAdapter(mockConfig);
  });

  it('should construct the auth client in constructor', () => {
    // v7 constructor builds AuthClient synchronously (no static create()).
    expect(AuthClient).toHaveBeenCalled();
  });

  it('should not have agent initially', () => {
    expect(adapter['agent']).toBeNull();
  });

  it('should reject when authentication fails', async () => {
    mockInstance.isAuthenticated.mockReturnValue(false);
    mockInstance.signIn.mockRejectedValue(new Error('Test error'));

    await expect(adapter.connect()).rejects.toThrow('Test error');
  });

  it('should connect successfully when signIn resolves an identity', async () => {
    const mockPrincipal = {
      isAnonymous: () => false,
      toText: () => 'test-principal-123',
      toString: () => 'test-principal-123',
      toUint8Array: () => new Uint8Array([1, 2, 3]),
    };
    const mockIdentity = { getPrincipal: () => mockPrincipal };

    mockInstance.isAuthenticated.mockReturnValue(false);
    mockInstance.signIn.mockResolvedValue(mockIdentity);

    const account = await adapter.connect();

    expect(account).toBeDefined();
    expect(account.owner).toBe('test-principal-123');
  });
});

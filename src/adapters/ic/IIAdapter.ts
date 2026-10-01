// src/adapters/ic/IIAdapter.ts

import { type ActorSubclass, Identity, HttpAgent } from "@icp-sdk/core/agent";
import { AuthClient } from "@icp-sdk/auth/client";
import { type Wallet, Adapter } from "../../types/index.d";
import { BaseAdapter } from "../BaseAdapter";
import { createAccountFromPrincipal } from "../../utils";
import { getScreenDimensions } from "../../utils/browser";
import { IIAdapterConfig } from '../../types/AdapterConfigs';
import { isIIAdapterConfig } from '../../types/AdapterConfigs';

// Extend BaseIcAdapter
export class IIAdapter extends BaseAdapter<IIAdapterConfig> implements Adapter.Interface {
  // II specific properties
  private authClient: AuthClient | null = null;
  private agent: HttpAgent | null = null;

  constructor(args: { adapter: any; config: IIAdapterConfig } | IIAdapterConfig) {
    // Support simplified constructor in tests: new IIAdapter(config)
    const normalized = ((): { adapter: any; config: IIAdapterConfig } => {
      if ('config' in (args as any)) {
        return args as { adapter: any; config: IIAdapterConfig };
      }
      return {
        adapter: {
          id: 'ii',
          enabled: true,
          walletName: 'Internet Identity',
          logo: undefined,
          website: 'https://internetcomputer.org',
          chain: 'ICP',
          adapter: IIAdapter,
          config: {}
        },
        config: args as IIAdapterConfig,
      };
    })();

    if (!isIIAdapterConfig(normalized.config)) {
      throw new Error('Invalid config for IIAdapter');
    }
    super(normalized as any);

    // @icp-sdk/auth v7 AuthClient: synchronous constructor (no static `create`).
    // Build it eagerly so Safari popups aren't blocked by async work later.
    this.initializeAuthClientSync();
  }

  private initializeAuthClientSync(): void {
    try {
      this.authClient = new AuthClient({
        // Library default identityProvider is `https://id.ai/authorize` (II 2.0).
        // Only override when consumer supplies a custom URL.
        ...(this.config.iiProviderUrl
          ? { identityProvider: this.config.iiProviderUrl }
          : {}),
        derivationOrigin: this.config.derivationOrigin,
        windowOpenerFeatures: (() => {
          const screen = getScreenDimensions();
          return `width=500,height=600,left=${screen.width / 2 - 250},top=${
            screen.height / 2 - 300
          }`;
        })(),
        idleOptions: {
          idleTimeout: Number(
            this.config.delegationTimeout ?? 1000 * 60 * 60 * 24,
          ),
          disableDefaultIdleCallback: true,
        },
      });
      this.authClient.idleManager?.registerCallback?.(() => this.refreshLogin());
    } catch (err) {
      this.handleError("Failed to create AuthClient", err);
      this.setState(Adapter.Status.ERROR);
    }
  }

  private ensureAuthClient(): void {
    if (!this.authClient) {
      throw new Error("AuthClient is not initialized");
    }
  }

  async openChannel(): Promise<void> {
    // No-op for II adapter - AuthClient is initialized in constructor.
    return Promise.resolve();
  }

  private async initAgent(identity: Identity): Promise<void> {
    const agent = await this.buildHttpAgent({ identity });
    this.agent = agent;
  }

  async connect(): Promise<Wallet.Account> {
    try {
      this.setState(Adapter.Status.CONNECTING);
      this.ensureAuthClient();

      // v7: isAuthenticated() is now synchronous.
      if (this.authClient!.isAuthenticated()) {
        const identity = await this.authClient!.getIdentity();
        const principal = identity?.getPrincipal();

        if (identity && principal && !principal.isAnonymous()) {
          const account = await this.createAccountFromIdentity(identity);
          this.setState(Adapter.Status.CONNECTED);
          return account;
        }
      }

      return await this.performLogin();
    } catch (error) {
      this.setState(Adapter.Status.ERROR);
      throw error;
    }
  }

  private async performLogin(): Promise<Wallet.Account> {
    const identityProvider =
      this.config.iiProviderUrl || "https://id.ai/#authorize";
    console.log(`[IIAdapter] Using Identity Provider: ${identityProvider}`);

    try {
      // v7: signIn() is promise-based (no onSuccess/onError callbacks).
      // identityProvider/derivationOrigin/windowOpenerFeatures already set in constructor.
      const identity = await this.authClient.signIn({
        maxTimeToLive:
          this.config.delegationTimeout ??
          BigInt(1 * 24 * 60 * 60 * 1000 * 1000 * 1000),
      });
      const account = await this.createAccountFromIdentity(identity);
      this.setState(Adapter.Status.CONNECTED);
      return account;
    } catch (error) {
      this.handleError("Login error", error);
      this.setState(Adapter.Status.ERROR);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`II Authentication failed: ${message}`);
    }
  }

  private async createAccountFromIdentity(identity: Identity): Promise<Wallet.Account> {
    if (!identity) {
      throw new Error("No identity available after login");
    }

    const principal = identity.getPrincipal();

    if (principal.isAnonymous()) {
      throw new Error(
        "Authentication failed: Anonymous principal returned. " +
        "This usually means the authentication was cancelled or failed."
      );
    }
    
    await this.initAgent(identity);
    
    const account = await createAccountFromPrincipal(principal);
    if (!account || !account.owner) {
      throw new Error("Failed to create valid account from principal");
    }
    
    return account;
  }

  async isConnected(): Promise<boolean> {
    return this.authClient ? this.authClient.isAuthenticated() : false;
  }

  // Implementation for BaseIcAdapter actor caching
  protected createActorInternal<T>(
    canisterId: string, 
    idl: any,
    _options?: {
      requiresSigning?: boolean;
    }
  ): ActorSubclass<T> {
    if (!this.agent) {
      throw new Error("Agent not initialized. Connect first.");
    }

    return this.createActorWithAgent<T>(this.agent, canisterId, idl);
  }

  async getPrincipal(): Promise<string> {
    if (!this.authClient) throw new Error("Not connected");
    const identity = await this.authClient.getIdentity();
    if (!identity) throw new Error("Identity not available");
    const principal = identity.getPrincipal();
    return principal.toText();
  }

  /**
   * Get the identity provider URL being used
   * @returns The identity provider URL (e.g., 'https://id.ai' for II 2.0 or 'https://identity.ic0.app' for II 1.0)
   */
  getIdentityProvider(): string {
    return this.config.iiProviderUrl || 'https://id.ai/authorize';
  }

  /**
   * Check if using the legacy II provider
   * @returns true if using the legacy provider (identity.ic0.app or icp0.io)
   */
  isLegacyProvider(): boolean {
    const provider = this.getIdentityProvider();
    return provider.includes('ic0.app') || provider.includes('icp0.io');
  }

  private async refreshLogin(): Promise<void> {
    try {
      this.ensureAuthClient();
      await this.performLogin();
    } catch (error) {
      this.handleError('Failed to refresh login', error);
      await this.disconnect().catch(() => {});
    }
  }

  // Disconnect logic specific to II
  protected async disconnectInternal(): Promise<void> {
    if (this.authClient) {
      // v7 renamed logout → signOut.
      await this.authClient.signOut();
    }
  }

  // Cleanup logic specific to II
  protected cleanupInternal(): void {
      this.authClient = null;
      this.agent = null;
  }

  /**
   * Dispose of II-specific resources
   * Ensures AuthClient and agent are properly cleaned up
   */
  protected async onDispose(): Promise<void> {
    // Ensure sign-out if still connected
    if (this.authClient) {
      try {
        await this.authClient.signOut();
      } catch (error) {
        // Best effort - already disposing
      }
      this.authClient = null;
    }
    this.agent = null;
  }
}
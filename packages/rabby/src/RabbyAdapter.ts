// Rabby Wallet Adapter for SIWE (Sign-In with Ethereum)
import { 
  Adapter, 
  Wallet, 
  BaseSiwxAdapter, 
  deriveAccountId,
  type AdapterConstructorArgs 
} from "@windoge98/plug-n-play";
import { ActorSubclass } from "@icp-sdk/core/agent";
import {
  Ed25519KeyIdentity,
  DelegationIdentity,
  DelegationChain,
} from "@icp-sdk/core/identity";
import { SiweManager } from "ic-siwe-js";
import { createWalletClient, custom, type WalletClient } from "viem";
import { mainnet } from "viem/chains";

// Check if we're in a browser environment
const isBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

// Configuration specific to Rabby
export interface RabbyAdapterConfig {
  enabled: boolean;
  siweProviderCanisterId?: string;
  providerCanisterId?: string;
  maxTimeToLive?: bigint;
  derivationOrigin?: string;
  hostUrl?: string;
}

/**
 * Rabby wallet adapter implementation for SIWE (Sign-In with Ethereum)
 * Extends BaseSiwxAdapter to provide IC integration via Ethereum signatures
 */
export class RabbyAdapter extends BaseSiwxAdapter<RabbyAdapterConfig> {
  public readonly id: string = 'rabby';
  static supportedChains: Adapter.Chain[] = [
    Adapter.Chain.ICP,
    Adapter.Chain.ETH,
  ];

  private siweManager: SiweManager | null = null;
  private ethereumAddress: string | null = null;
  private connectingPromise: Promise<Wallet.Account> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Prefer SIWE-specific canister keys to avoid accidentally picking SIWS
  protected resolveProviderCanisterId(): string {
    const cfg: any = this.config as any;
    const canisterId = cfg.providerCanisterId || cfg.siweProviderCanisterId || cfg.siwsProviderCanisterId;
    if (!canisterId) {
      throw new Error("SIWE provider canister ID not configured");
    }
    return String(canisterId);
  }

  constructor(args: AdapterConstructorArgs<RabbyAdapterConfig>) {
    super(args);
    this.setState(Adapter.Status.READY);
  }

  // Implement abstract methods from BaseDelegationAdapter
  protected async onStorageRestored(
    sessionKey: Ed25519KeyIdentity,
    delegationChain: DelegationChain
  ): Promise<void> {
    // Restore the Ethereum address
    const storedEthAddress = await this.readExternalAddress(`${this.id}-eth-address`);
    if (storedEthAddress) this.ethereumAddress = storedEthAddress;
    
    // Verify ic-siwe-js state is also present
    try {
      const siweIdentity = localStorage.getItem('siweIdentity');
      if (!siweIdentity) {
        // ic-siwe-js state missing, clear our storage to force fresh login
        this.logger.debug(`[${this.id}] ic-siwe-js state missing, clearing stored session`);
        await this.clearStoredSession();
        this.setState(Adapter.Status.READY);
      }
    } catch (error) {
      this.logger.debug(`[${this.id}] Failed to check ic-siwe-js state:`, { error });
      await this.clearStoredSession();
      this.setState(Adapter.Status.READY);
    }
  }

  protected async onClearStoredSession(): Promise<void> {
    // Clear SIWE-specific data
    this.ethereumAddress = null;
    await this.storage.remove(`${this.id}-eth-address`);
    if (this.siweManager) {
      this.siweManager.clear();
    }
  }

  async isConnected(): Promise<boolean> {
    return (
      this.identity !== null &&
      !this.identity.getPrincipal().isAnonymous()
    );
  }

  private async handleConnectionFailure(error: any): Promise<void> {
    // Clear timeout if still active
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Clean up SIWE manager
    if (this.siweManager) {
      try {
        this.siweManager.clear();
      } catch (clearError) {
        this.logger.debug(`[${this.id}] Error clearing SIWE manager:`, { clearError });
      }
      this.siweManager = null;
    }

    // Clear stored session
    await this.clearStoredSession();

    // Reset state based on error type
    const errorMessage = error?.message || error?.toString() || '';
    if (
      errorMessage.includes('cancelled') ||
      errorMessage.includes('rejected') ||
      errorMessage.includes('timeout')
    ) {
      this.setState(Adapter.Status.DISCONNECTED);
    } else {
      this.setState(Adapter.Status.ERROR);
    }

    this.logger.error(`[${this.id}] Connection failed:`, error);
  }

  async connect(): Promise<Wallet.Account> {
    // Prevent concurrent connections that can race prepare/login
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = (async () => {
      if (!isBrowser) {
        throw new Error("Cannot connect to wallet in non-browser environment");
      }

      // If we're already connected, return the current account
      if (this.identity && this.state === Adapter.Status.CONNECTED) {
        const principal = (this.identity as DelegationIdentity).getPrincipal();
        return {
          owner: principal.toText(),
          subaccount: deriveAccountId(principal),
        };
      }

      // Try to restore from storage first
      if (!this.identity) {
        try {
          await super.restoreFromStorage();
          if (this.identity && this.state === Adapter.Status.CONNECTED) {
            const principal = (this.identity as DelegationIdentity).getPrincipal();
            return {
              owner: principal.toText(),
              subaccount: deriveAccountId(principal),
            };
          }
        } catch (error) {
          this.logger.debug(`[${this.id}] Failed to restore from storage during connect attempt:`, { error });
          await this.clearStoredSession();
        }
      }

      this.setState(Adapter.Status.CONNECTING);

      // Set a connection timeout
      const timeoutMs = 45000; // 45 seconds
      this.connectionTimeout = setTimeout(() => {
        this.logger.warn(`[${this.id}] Connection timeout after ${timeoutMs}ms`);
        this.handleConnectionFailure(new Error("Connection timeout"));
      }, timeoutMs);

      try {
        // Check if Rabby is available
        const win = window as any;
        if (!win.ethereum || !win.ethereum.isRabby) {
          throw new Error("Rabby wallet is not installed. Please install Rabby wallet to use this wallet.");
        }

        // Initialize SIWE Manager
        const canisterId = this.resolveProviderCanisterId();

        this.siweManager = new SiweManager(
          canisterId,
          {
            host: this.config.hostUrl,
          }
        );

        // Create a wallet client for Rabby
        const walletClient = createWalletClient({
          chain: mainnet,
          transport: custom(win.ethereum)
        });

        // First, request account access from Rabby
        let accounts: `0x${string}`[];
        try {
          accounts = await walletClient.requestAddresses();
        } catch (error: any) {
          // Handle user rejection or window close
          if (
            error.code === 4001 || // User rejected request
            error.code === -32002 || // Request already pending
            error.message?.includes("User rejected") ||
            error.message?.includes("User denied") ||
            error.message?.includes("rejected")
          ) {
            this.logger.debug(`[${this.id}] User rejected Rabby connection`);
            throw new Error("Connection cancelled by user");
          }
          throw error;
        }

        if (!accounts || accounts.length === 0) {
          throw new Error("No Ethereum accounts available");
        }
        
        // Store the address immediately
        this.ethereumAddress = accounts[0];

        // Set the wallet client for the SIWE manager AFTER we have account access
        this.siweManager.setWalletClient(walletClient);

        // Now login with SIWE - this will:
        // 1. Prepare the SIWE message
        // 2. Sign the message with the already-connected wallet
        // 3. Create the delegation identity
        let delegationIdentity;
        try {
          delegationIdentity = await this.siweManager.login();
        } catch (error: any) {
          // Handle signing rejection or window close
          if (
            error.code === 4001 || // User rejected request
            error.message?.includes("User rejected") ||
            error.message?.includes("User denied") ||
            error.message?.includes("rejected") ||
            error.message?.includes("cancelled")
          ) {
            this.logger.debug(`[${this.id}] User rejected signing SIWE message`);
            throw new Error("Signing cancelled by user");
          }
          throw error;
        }
        
        if (!delegationIdentity) {
          throw new Error("SIWE login failed");
        }

        this.identity = delegationIdentity;
        
        // Get the Ethereum address from the state store
        // Access the internal state store to get the identity address
        const stateStore = (this.siweManager as any).siweStateStore || (this.siweManager as any).stateStore;
        if (stateStore) {
          const state = stateStore.getSnapshot ? stateStore.getSnapshot() : stateStore.get?.();
          if (state?.identityAddress) {
            const addr: string = state.identityAddress as string;
            this.ethereumAddress = addr;
            await this.storeExternalAddress(`${this.id}-eth-address`, addr);
          }
        }

        // Get the session key from the delegation identity
        const delegationChain = delegationIdentity.getDelegation();
        const sessionKey = (delegationIdentity as any)._inner;
        if (sessionKey instanceof Ed25519KeyIdentity) {
          this.sessionKey = sessionKey;
          await this.storeSession(this.sessionKey, delegationChain);
        }

        const principal = (this.identity as DelegationIdentity).getPrincipal();
        if (!principal || principal.isAnonymous()) {
          await this.clearStoredSession();
          throw new Error("SIWE login failed: Resulted in anonymous principal.");
        }
        
        this.logger.debug(`[${this.id}] Successfully connected and session stored.`);
        
        // Clear timeout on successful connection
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
        
        this.setState(Adapter.Status.CONNECTED);
        
        return {
          owner: principal.toText(),
          subaccount: deriveAccountId(principal),
        };
      } catch (error) {
        await this.handleConnectionFailure(error);
        throw error;
      }
    })();

    try {
      return await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  async getPrincipal(): Promise<string> {
    if (!this.identity) {
      throw new Error("Not connected");
    }
    return this.identity.getPrincipal().toText();
  }

  async getAccountId(): Promise<string> {
    if (!this.identity) {
      throw new Error("Not connected");
    }
    const principal = this.identity.getPrincipal();
    return deriveAccountId(principal);
  }

  async getAddresses(): Promise<Adapter.Addresses> {
    const principal = this.identity?.getPrincipal();
    return {
      eth: {
        address: this.ethereumAddress,
        network: 'mainnet',
      },
      icp: {
        address: principal?.toText(),
        subaccount: principal ? deriveAccountId(principal) : undefined,
      },
    };
  }

  protected async disconnectInternal(): Promise<void> {
    // Clear connection timeout if active
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    this.ethereumAddress = null;
    if (this.siweManager) {
      this.siweManager.clear();
      this.siweManager = null;
    }
    await super.disconnectInternal();
  }

  protected createActorInternal<T>(
    canisterId: string,
    idl: any,
    options?: { requiresSigning?: boolean }
  ): ActorSubclass<T> {
    const requiresSigning = options?.requiresSigning ?? true;
    if (requiresSigning && !this.identity) {
      throw new Error("Cannot create signed actor: Not connected");
    }
    const agent = this.buildHttpAgentSync({ identity: this.identity ?? undefined });
    return this.createActorWithAgent<T>(agent as any, canisterId, idl);
  }
}
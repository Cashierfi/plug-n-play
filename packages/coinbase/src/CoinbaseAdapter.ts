// Coinbase Wallet Adapter for SIWS (Sign-In with Solana)
import {
  BaseSiwxAdapter,
  Adapter,
  Wallet,
  deriveAccountId,
  formatSiwsMessage
} from '@windoge98/plug-n-play';
import { ActorSubclass, AnonymousIdentity, type Identity } from "@icp-sdk/core/agent";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { WalletAdapterNetwork, WalletReadyState } from "@solana/wallet-adapter-base";
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Ed25519KeyIdentity, DelegationIdentity, DelegationChain } from "@icp-sdk/core/identity";
import bs58 from "bs58";
// @ts-ignore - DID file import
import { idlFactory as siwsProviderIdlFactory } from './did/ic_siws_provider.did.js';
// @ts-ignore - DID type import  
import type { _SERVICE as SiwsProviderService } from './did/ic_siws_provider';

// Configuration specific to Coinbase
export interface CoinbaseAdapterConfig {
  enabled: boolean;
  solanaNetwork?: WalletAdapterNetwork;
  siwsProviderCanisterId?: string;
  providerCanisterId?: string;
  rpcEndpoint?: string;
}

/**
 * Coinbase-specific SIWS adapter implementation
 * Provides Sign-In with Solana functionality for Coinbase wallet
 */
export class CoinbaseAdapter extends BaseSiwxAdapter<CoinbaseAdapterConfig> {
  public walletName: string = 'Coinbase Wallet';
  public logo: string;
  public readonly id: string = 'coinbase';
  static supportedChains: Adapter.Chain[] = [
    Adapter.Chain.ICP,
    Adapter.Chain.SOL,
  ];

  private coinbaseAdapter: CoinbaseWalletAdapter | null = null;
  private solanaConnection!: Connection; // Initialized in constructor via initializeConnection()
  private solanaAddress: string | null = null;
  private connectingPromise: Promise<Wallet.Account> | null = null;

  protected resolveProviderCanisterId(): string {
    const cfg: any = this.config as any;
    const canisterId = cfg.providerCanisterId || cfg.siwsProviderCanisterId;
    if (!canisterId) {
      throw new Error("SIWS provider canister ID not configured.");
    }
    return String(canisterId);
  }

  constructor(args: Adapter.ConstructorArgs & { config: CoinbaseAdapterConfig }) {
    super(args);
    this.id = args.adapter.id;
    this.walletName = args.adapter.walletName;
    this.logo = args.adapter.logo;
    this.config = args.config;
    
    this.initializeConnection();
    
    // Initialize Coinbase adapter if in browser
    if (this.isBrowser()) {
      this.initializeCoinbaseAdapter();
    }

    this.setState(Adapter.Status.READY);
  }

  private isBrowser(): boolean {
    return typeof window !== "undefined" && typeof window.document !== "undefined";
  }

  private initializeConnection(): void {
    const network = this.config.solanaNetwork || WalletAdapterNetwork.Mainnet;
    const endpoint = this.config.rpcEndpoint || (
      network === WalletAdapterNetwork.Mainnet
        ? "https://api.mainnet-beta.solana.com"
        : "https://api.devnet.solana.com"
    );
    this.solanaConnection = new Connection(endpoint);
  }

  private initializeCoinbaseAdapter(): void {
    this.coinbaseAdapter = new CoinbaseWalletAdapter();
    this.setupWalletListeners();
  }

  private setupWalletListeners(): void {
    if (!this.coinbaseAdapter) return;
    
    this.coinbaseAdapter.on("connect", this.handleCoinbaseConnect);
    this.coinbaseAdapter.on("disconnect", this.handleCoinbaseDisconnect);
    this.coinbaseAdapter.on("error", this.handleCoinbaseError);
  }

  private removeWalletListeners(): void {
    if (!this.coinbaseAdapter) return;
    
    this.coinbaseAdapter.off("connect", this.handleCoinbaseConnect);
    this.coinbaseAdapter.off("disconnect", this.handleCoinbaseDisconnect);
    this.coinbaseAdapter.off("error", this.handleCoinbaseError);
  }

  private handleCoinbaseConnect = (publicKey: PublicKey): void => {
    this.solanaAddress = publicKey.toBase58();
    this.logger.debug(`Coinbase wallet connected`, { address: this.solanaAddress });
  };

  private handleCoinbaseDisconnect = (): void => {
    if (
      this.state !== Adapter.Status.DISCONNECTING &&
      this.state !== Adapter.Status.DISCONNECTED
    ) {
      this.disconnect();
    }
  };

  private handleCoinbaseError = (error: any): void => {
    this.logger.error(`Coinbase wallet error`, error, {
      wallet: this.walletName,
    });
    this.setState(Adapter.Status.ERROR);
    this.disconnect();
  };

  destroy(): void {
    this.removeWalletListeners();
  }

  async isConnected(): Promise<boolean> {
    if (!this.coinbaseAdapter) return false;
    return (
      this.coinbaseAdapter.connected &&
      this.identity !== null &&
      !this.identity.getPrincipal().isAnonymous()
    );
  }

  async connect(): Promise<Wallet.Account> {
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = (async () => {
      if (!this.isBrowser()) {
        throw new Error("Cannot connect to Coinbase wallet in non-browser environment");
      }

      // Validate provider canister
      this.resolveProviderCanisterId();

      // If already connected, return the current account
      if (this.identity && this.state === Adapter.Status.CONNECTED) {
        const principal = this.identity.getPrincipal();
        return {
          owner: principal.toText(),
          subaccount: deriveAccountId(principal),
        };
      }

      this.setState(Adapter.Status.CONNECTING);

      try {
        // Ensure Coinbase adapter is ready
        if (!this.coinbaseAdapter) {
          this.initializeCoinbaseAdapter();
        }
        
        if (!this.coinbaseAdapter) {
          throw new Error("Failed to initialize Coinbase adapter");
        }

        // Connect to Coinbase wallet if not already connected
        if (!this.coinbaseAdapter.connected) {
          this.logger.debug(`Connecting to Coinbase wallet...`);
          
          // Check if Coinbase is installed
          if (this.coinbaseAdapter.readyState === WalletReadyState.NotDetected) {
            throw new Error("Coinbase wallet is not installed. Please install the Coinbase Wallet browser extension.");
          }
          
          try {
            await this.coinbaseAdapter.connect();
          } catch (error: any) {
            this.logger.error(`Coinbase connection error`, error, {
              wallet: this.walletName,
            });
            
            if (
              error.name === "WalletWindowClosedError" ||
              error.message?.includes("User rejected the request") ||
              error.message?.includes("Wallet closed")
            ) {
              this.setState(Adapter.Status.DISCONNECTED);
              throw new Error("Connection cancelled by user");
            }
            
            this.setState(Adapter.Status.ERROR);
            throw error;
          }
        }
        
        // Verify connection was successful
        if (!this.coinbaseAdapter.publicKey) {
          throw new Error("Coinbase wallet connected but no public key available");
        }
        
        // Verify adapter supports message signing (required for SIWS)
        if (!("signMessage" in this.coinbaseAdapter)) {
          throw new Error(`Coinbase wallet does not support message signing required for SIWS`);
        }
        
        // Perform SIWS authentication
        const address = this.coinbaseAdapter.publicKey.toBase58();
        this.solanaAddress = address;
        await this.storeExternalAddress(`${this.id}-solana-address`, address);

        const { identity, sessionKey } = await this.performSiwsLogin(address, this.coinbaseAdapter);
        this.identity = identity;
        this.sessionKey = sessionKey;

        const principal = identity.getPrincipal();
        this.setState(Adapter.Status.CONNECTED);
        return {
          owner: principal.toText(),
          subaccount: deriveAccountId(principal),
        };
      } catch (error) {
        this.logger.error(`Connect process failed`, error as Error, {
          wallet: this.walletName,
        });
        
        this.setState(Adapter.Status.ERROR);
        throw error;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  private async createSiwsProviderActor(identity?: Identity): Promise<ActorSubclass<SiwsProviderService>> {
    const id = identity ?? new AnonymousIdentity();
    return this.createProviderActor<SiwsProviderService>(siwsProviderIdlFactory, id);
  }

  private async signSiwsMessage(siwsMessage: any, adapter: CoinbaseWalletAdapter): Promise<string> {
    const messageText = formatSiwsMessage(siwsMessage);
    const messageBytes = new TextEncoder().encode(messageText);

    if (!("signMessage" in adapter)) {
      throw new Error(`Coinbase wallet does not support signMessage.`);
    }

    const signatureBytes: any = await adapter.signMessage(messageBytes);

    // Normalize to base58
    if (signatureBytes instanceof Uint8Array) {
      return bs58.encode(signatureBytes);
    }
    if (signatureBytes instanceof ArrayBuffer) {
      return bs58.encode(new Uint8Array(signatureBytes));
    }
    
    // Handle any other format
    try {
      const arr = Array.isArray(signatureBytes) ? signatureBytes : Object.values(signatureBytes as any);
      return bs58.encode(new Uint8Array(arr as any));
    } catch (e) {
      this.logger.error(`Error encoding signature`, e as Error, { wallet: this.walletName });
      throw new Error(`Failed to encode signature from Coinbase: ${(e as Error).message}`);
    }
  }

  private async performSiwsLogin(
    address: string,
    adapter: CoinbaseWalletAdapter,
  ): Promise<{ identity: DelegationIdentity; sessionKey: Ed25519KeyIdentity }> {
    const actor = await this.createSiwsProviderActor();

    // 1) Prepare login
    const prepareResult = await actor.siws_prepare_login(address);
    if ("Err" in prepareResult) {
      throw new Error(`SIWS Prepare Login failed: ${prepareResult.Err}`);
    }

    // 2) Sign message
    const signature = await this.signSiwsMessage(prepareResult.Ok, adapter);

    // 3) Generate session identity and do login
    const sessionIdentity = Ed25519KeyIdentity.generate();
    const sessionPublicKeyDer = sessionIdentity.getPublicKey().toDer();

    const loginResult = await actor.siws_login(
      signature,
      address,
      new Uint8Array(sessionPublicKeyDer),
      prepareResult.Ok.nonce,
    );
    if ("Err" in loginResult) {
      throw new Error(`SIWS Login failed: ${loginResult.Err}`);
    }

    // 4) Fetch signed delegation
    const delegationResult = await actor.siws_get_delegation(
      address,
      new Uint8Array(sessionPublicKeyDer),
      loginResult.Ok.expiration,
    );
    if ("Err" in delegationResult) {
      throw new Error(`SIWS Get Delegation failed: ${delegationResult.Err}`);
    }

    // 5) Build identity
    const identity = this.createDelegationIdentity(
      delegationResult.Ok,
      sessionIdentity,
      new Uint8Array(loginResult.Ok.user_canister_pubkey).buffer as ArrayBuffer,
    );

    return { identity, sessionKey: sessionIdentity };
  }

  protected async disconnectInternal(): Promise<void> {
    // Clear stored delegation session and identity
    await super.disconnectInternal();
    
    // Disconnect Coinbase adapter
    if (this.coinbaseAdapter) {
      try {
        if (this.coinbaseAdapter.connected) {
          this.removeWalletListeners();
          await this.coinbaseAdapter.disconnect();
          this.setupWalletListeners();
        }
      } catch (error) {
        this.logger.warn(`Error during Coinbase disconnect`, {
          error,
          wallet: this.walletName,
        });
      }
    }
    
    // Clear local state
    this.identity = null;
    this.solanaAddress = null;
  }

  async getPrincipal(): Promise<string> {
    if (!this.identity) {
      throw new Error("Not connected or SIWS flow not completed.");
    }
    return this.identity.getPrincipal().toText();
  }

  async getAccountId(): Promise<string> {
    const principal = await this.getPrincipal();
    if (!principal)
      throw new Error("Principal not available to derive account ID");
    return deriveAccountId(principal);
  }

  async getSolanaAddress(): Promise<string> {
    if (!this.solanaAddress) {
      throw new Error("Not connected or Solana address not available.");
    }
    return this.solanaAddress;
  }

  async getAddresses(): Promise<Adapter.Addresses> {
    const principal = this.identity?.getPrincipal();
    return {
      sol: {
        address: this.solanaAddress,
        network: this.config.solanaNetwork,
      },
      icp: {
        address: principal?.toText(),
        subaccount: principal ? deriveAccountId(principal) : undefined,
      },
    };
  }

  protected createActorInternal<T>(
    canisterId: string,
    idl: any,
    options?: { requiresSigning?: boolean },
  ): ActorSubclass<T> {
    const requiresSigning = options?.requiresSigning ?? true;
    if (requiresSigning && !this.identity) {
      throw new Error(
        "Cannot create signed actor: Not connected or SIWS flow not completed.",
      );
    }
    const agent = this.buildHttpAgentSync({ identity: this.identity ?? undefined });
    return this.createActorWithAgent<T>(agent as any, canisterId, idl);
  }

  async getSolBalance(): Promise<{ amount: number; usdValue?: number }> {
    if (!this.coinbaseAdapter?.publicKey) {
      throw new Error("Wallet not connected");
    }

    try {
      const balance = await this.solanaConnection.getBalance(this.coinbaseAdapter.publicKey);
      const solAmount = balance / LAMPORTS_PER_SOL;
      
      // USD value can be fetched from a price API if needed
      return { amount: solAmount };
    } catch (error) {
      this.logger.error(`Failed to get SOL balance`, error as Error, {
        wallet: this.walletName,
      });
      throw error;
    }
  }

  async estimateTransactionFee(transaction: Transaction): Promise<number> {
    if (!this.coinbaseAdapter?.publicKey) {
      throw new Error("Wallet not connected");
    }

    try {
      const { blockhash } = await this.solanaConnection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.coinbaseAdapter.publicKey;

      const message = transaction.compileMessage();
      const fee = await this.solanaConnection.getFeeForMessage(message, 'confirmed');
      
      if (fee.value === null) {
        throw new Error("Unable to estimate fee");
      }
      
      return fee.value / LAMPORTS_PER_SOL;
    } catch (error) {
      this.logger.error(`Failed to estimate transaction fee`, error as Error, {
        wallet: this.walletName,
      });
      throw error;
    }
  }

  async getTransactionStatus(signature: string): Promise<{
    confirmed: boolean;
    slot?: number;
    err?: any;
  }> {
    try {
      const status = await this.solanaConnection.getSignatureStatus(signature);
      
      if (!status.value) {
        return { confirmed: false };
      }
      
      return {
        confirmed: status.value.confirmationStatus === 'confirmed' || 
                  status.value.confirmationStatus === 'finalized',
        slot: status.value.slot,
        err: status.value.err,
      };
    } catch (error) {
      this.logger.error(`Failed to get transaction status`, error as Error, {
        wallet: this.walletName,
        signature,
      });
      throw error;
    }
  }

  protected async onStorageRestored(_sessionKey: Ed25519KeyIdentity, _delegationChain: DelegationChain): Promise<void> {
    const storedSolanaAddress = await this.readExternalAddress(`${this.id}-solana-address`);
    if (storedSolanaAddress) this.solanaAddress = storedSolanaAddress;
  }

  protected async onClearStoredSession(): Promise<void> {
    this.solanaAddress = null;
    await this.storage.remove(`${this.id}-solana-address`);
  }
}
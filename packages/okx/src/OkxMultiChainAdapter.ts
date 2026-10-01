// OKX Multi-Chain Wallet Adapter
import { 
  BaseMultiChainAdapter, 
  NetworkDetection, 
  MultiChainConfig,
  BaseAdapter,
  type AdapterConstructorArgs,
  BaseSiwxAdapter,
  Adapter,
  type Wallet,
  deriveAccountId,
  formatSiwsMessage
} from '@windoge98/plug-n-play';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import type { PublicKey } from '@solana/web3.js';
import { ActorSubclass, AnonymousIdentity, type Identity } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity, DelegationIdentity, DelegationChain } from "@icp-sdk/core/identity";
import bs58 from "bs58";
// @ts-ignore - DID file import
import { idlFactory as siwsProviderIdlFactory } from './did/ic_siws_provider.did.js';

// Extended window interface for OKX wallet
declare global {
  interface Window {
    okxwallet?: {
      // Ethereum/EVM methods
      request?: (args: { method: string; params?: any[] }) => Promise<any>;
      isConnected?: () => boolean;
      selectedAddress?: string;
      chainId?: string;
      
      // Solana provider
      solana?: {
        isConnected: boolean;
        publicKey?: PublicKey;
        connect: () => Promise<{ publicKey: PublicKey }>;
        disconnect: () => Promise<void>;
        signMessage: (message: Uint8Array) => Promise<Uint8Array>;
        signTransaction: (transaction: any) => Promise<any>;
        signAllTransactions: (transactions: any[]) => Promise<any[]>;
        on: (event: string, handler: Function) => void;
        off: (event: string, handler: Function) => void;
      };
      
      // Bitcoin provider (for future expansion)
      bitcoin?: {
        connect: () => Promise<void>;
        getAccounts: () => Promise<string[]>;
      };
    };
  }
}

/**
 * OKX-specific configuration extending multi-chain config
 */
export interface OkxMultiChainConfig extends MultiChainConfig {
  solanaNetwork?: WalletAdapterNetwork;
  siwsProviderCanisterId?: string;
  siweProviderCanisterId?: string;
}

/**
 * Internal Solana adapter for OKX wallet
 */
class OkxSolanaNetworkAdapter extends BaseSiwxAdapter<any> {
  private solanaAddress: string | null = null;
  protected identity: DelegationIdentity | null = null;
  protected sessionKey: Ed25519KeyIdentity | null = null;

  constructor(args: AdapterConstructorArgs<any>) {
    super({
      ...args,
      adapter: {
        ...args.adapter,
        id: 'okxSolana',
        walletName: 'OKX Wallet (Solana)',
      }
    });
  }

  async connect(): Promise<Wallet.Account> {
    const win = window as any;
    
    if (!win.okxwallet?.solana) {
      throw new Error("OKX Wallet Solana provider not available");
    }

    try {
      // Connect to OKX Solana
      const response = await win.okxwallet.solana.connect();
      const address = response.publicKey.toBase58();
      this.solanaAddress = address;

      // Perform SIWS login
      const { identity, sessionKey } = await this.performSiwsLogin(address, win.okxwallet.solana);
      this.identity = identity;
      this.sessionKey = sessionKey;

      const principal = identity.getPrincipal();
      this.setState(Adapter.Status.CONNECTED);
      
      return {
        owner: principal.toText(),
        subaccount: deriveAccountId(principal),
      };
    } catch (error) {
      this.setState(Adapter.Status.ERROR);
      throw error;
    }
  }

  private async performSiwsLogin(
    address: string,
    provider: any
  ): Promise<{ identity: DelegationIdentity; sessionKey: Ed25519KeyIdentity }> {
    const actor = await this.createSiwsProviderActor();

    // 1) Prepare login
    const prepareResult = await actor.siws_prepare_login(address);
    if ("Err" in prepareResult) {
      throw new Error(`SIWS Prepare Login failed: ${prepareResult.Err}`);
    }

    // 2) Sign message
    const messageText = formatSiwsMessage(prepareResult.Ok);
    const messageBytes = new TextEncoder().encode(messageText);
    
    // OKX wallet requires specific signing approach
    let signatureBytes: Uint8Array;
    
    try {
      // OKX wallet's Solana provider may have signMessage but with different signature
      if (typeof provider.signMessage === 'function') {
        const result = await provider.signMessage(messageBytes, 'utf8');
        
        // Handle various response formats
        if (result?.signature) {
          signatureBytes = typeof result.signature === 'string' 
            ? bs58.decode(result.signature)
            : new Uint8Array(result.signature);
        } else if (result instanceof Uint8Array) {
          signatureBytes = result;
        } else if (Array.isArray(result)) {
          signatureBytes = new Uint8Array(result);
        } else {
          throw new Error('Unexpected signature format from OKX wallet');
        }
      } else if (typeof provider.sign === 'function') {
        // Some wallets use 'sign' instead of 'signMessage'
        const result = await provider.sign(messageBytes, 'utf8');
        signatureBytes = typeof result === 'string' 
          ? bs58.decode(result)
          : new Uint8Array(result);
      } else if (typeof provider.request === 'function') {
        // Try the request interface
        const result = await provider.request({
          method: 'signMessage',
          params: [bs58.encode(messageBytes), 'utf8']
        });
        signatureBytes = typeof result === 'string'
          ? bs58.decode(result)
          : new Uint8Array(result);
      } else {
        throw new Error('OKX wallet provider does not support any known message signing method');
      }
    } catch (error) {
      throw new Error(`Failed to sign message with OKX wallet: ${error}`);
    }
    
    const signature = bs58.encode(signatureBytes);

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
      new Uint8Array(loginResult.Ok.user_canister_pubkey).buffer as ArrayBuffer
    );

    return { identity, sessionKey: sessionIdentity };
  }

  private async createSiwsProviderActor(identity?: Identity): Promise<ActorSubclass<any>> {
    const id = identity ?? new AnonymousIdentity();
    return this.createProviderActor<any>(siwsProviderIdlFactory, id);
  }

  async isConnected(): Promise<boolean> {
    return this.identity !== null && !this.identity.getPrincipal().isAnonymous();
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
      sol: {
        address: this.solanaAddress,
        network: 'mainnet',
      },
      icp: {
        address: principal?.toText(),
        subaccount: principal ? deriveAccountId(principal) : undefined,
      },
    };
  }

  protected async disconnectInternal(): Promise<void> {
    const win = window as any;
    if (win.okxwallet?.solana) {
      try {
        await win.okxwallet.solana.disconnect();
      } catch {}
    }
    this.solanaAddress = null;
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

  protected async onStorageRestored(_sessionKey: Ed25519KeyIdentity, _delegationChain: DelegationChain): Promise<void> {
    // Restore Solana address if available
  }

  protected async onClearStoredSession(): Promise<void> {
    this.solanaAddress = null;
  }
}


/**
 * OKX Multi-Chain Adapter implementation
 * Supports Ethereum and Solana networks with automatic detection
 */
export class OkxMultiChainAdapter extends BaseMultiChainAdapter<OkxMultiChainConfig> {
  protected networkAdapters: Map<string, BaseAdapter> = new Map();

  constructor(args: AdapterConstructorArgs<OkxMultiChainConfig>) {
    super({
      ...args,
      config: {
        ...args.config,
        supportedNetworks: args.config.supportedNetworks || ['solana']
      }
    });
  }

  /**
   * Override connect to add OKX-specific error handling
   */
  async connect(): Promise<Wallet.Account> {
    try {
      // Call parent connect which handles the flow
      const result = await super.connect();
      return result;
    } catch (error) {
      // Add helpful guidance in the error message
      if ((error as any)?.message?.includes('SIWS provider')) {
        const enhancedError = new Error(
          `OKX Wallet connection failed: Please ensure siwsProviderCanisterId is configured in your PNP config`
        );
        throw enhancedError;
      }
      
      throw error;
    }
  }

  /**
   * Detect which network OKX wallet is currently connected to
   */
  async detectNetwork(): Promise<NetworkDetection> {
    const win = window as any;
    
    if (!win.okxwallet) {
      throw new Error("OKX Wallet is not installed. Please install OKX Wallet browser extension.");
    }
    
    // OKX adapter only supports Solana
    if (!win.okxwallet.solana) {
      throw new Error("OKX Wallet Solana provider not available. Please ensure OKX Wallet is properly installed.");
    }
    
    return { 
      network: 'solana',
      isTestnet: false
    };
  }

  /**
   * Get or create the appropriate network-specific adapter
   */
  protected async getNetworkAdapter(network: NetworkDetection): Promise<BaseAdapter> {
    // Check cache first
    const cached = this.networkAdapters.get(network.network);
    if (cached) {
      return cached;
    }
    
    // OKX only supports Solana
    if (network.network === 'solana') {
      const adapter = new OkxSolanaNetworkAdapter({
        adapter: {
          ...(this as any).adapter,
          chain: 'SOL' as const,
        },
        config: {
          ...(this as any).config,
          solanaNetwork: (this as any).config?.solanaNetwork || WalletAdapterNetwork.Mainnet,
          siwsProviderCanisterId: (this as any).config?.siwsProviderCanisterId,
          providerCanisterId: (this as any).config?.siwsProviderCanisterId,
        },
        logger: (this as any).logger
      });
      this.networkAdapters.set(network.network, adapter);
      return adapter;
    }
    
    throw new Error(`OKX wallet adapter only supports Solana network. Current network: ${network.network}`);
  }

  /**
   * Switch network (OKX supports programmatic network switching for EVM chains)
   */
  async switchNetwork(targetNetwork: string): Promise<void> {
    const win = window as any;
    
    if (!win.okxwallet) {
      throw new Error("OKX Wallet not available");
    }
    
    // For EVM networks, we can request a chain switch
    if (['ethereum', 'bsc', 'polygon', 'optimism', 'arbitrum', 'avalanche', 'fantom'].includes(targetNetwork)) {
      const chainIdMap: Record<string, string> = {
        'ethereum': '0x1',
        'bsc': '0x38',
        'polygon': '0x89',
        'optimism': '0xa',
        'arbitrum': '0xa4b1',
        'avalanche': '0xa86a',
        'fantom': '0xfa',
      };
      
      const targetChainId = chainIdMap[targetNetwork];
      if (!targetChainId) {
        throw new Error(`Unknown chain ID for network: ${targetNetwork}`);
      }
      
      try {
        await win.okxwallet.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
      } catch (error: any) {
        if (error.code === 4902) {
          throw new Error(`Please add ${targetNetwork} network to OKX Wallet manually`);
        }
        throw error;
      }
    } else {
      throw new Error(`Network switching to ${targetNetwork} must be done manually in OKX Wallet`);
    }
  }
}
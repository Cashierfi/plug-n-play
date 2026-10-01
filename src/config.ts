import { Adapter } from "./types";
import { Adapters } from "./adapters";
import { GlobalPnpConfig } from ".";
import { AdapterExtension, mergeAdapterExtensions } from "./types/AdapterExtensions";

// Clean configuration input
export interface CreatePnpArgs {
  network?: 'local' | 'ic';
  ports?: { replica?: number; frontend?: number };
  delegation?: { timeout?: bigint; targets?: string[] };
  security?: { fetchRootKey?: boolean; verifyQuerySignatures?: boolean };
  storage?: { key?: string };
  providers?: {
    siws?: string;
    siwe?: string; 
    frontend?: string;
  };
  extensions?: AdapterExtension<any>[]; // New: declarative adapter extensions
  adapters?: Record<string, AdapterOverride>;
}

// Adapter override with flat structure
type AdapterOverride = {
  enabled?: boolean;
  [key: string]: any;
};

// Defaults
const DEFAULTS = {
  network: 'ic' as const,
  ports: { replica: 8080, frontend: 3000 },
  delegation: {
    timeout: BigInt(24 * 60 * 60 * 1000 * 1000 * 1000),
    targets: [] as string[]
  },
  storage: { key: 'pnpState' }
};

/**
 * Build global settings object that will be shared across all adapters
 * Performance optimization: Single source of truth instead of copying into every adapter
 */
function buildGlobalSettings(
  input: CreatePnpArgs,
  network: 'local' | 'ic',
  ports: typeof DEFAULTS.ports,
  delegation: typeof DEFAULTS.delegation,
  storage: typeof DEFAULTS.storage,
  providers: CreatePnpArgs['providers'],
  hostUrl: string,
  derivationOrigin: string
) {
  const isLocal = network === 'local';
  return {
    hostUrl,
    derivationOrigin,
    fetchRootKey: input.security?.fetchRootKey ?? isLocal,
    verifyQuerySignatures: input.security?.verifyQuerySignatures ?? !isLocal,
    delegationTimeout: delegation.timeout,
    delegationTargets: delegation.targets,
    localStorageKey: storage.key,
    siwsProviderCanisterId: providers?.siws,
    siweProviderCanisterId: providers?.siwe,
    frontendCanisterId: providers?.frontend,
  };
}

/**
 * Build adapter configuration by merging base, overrides, and global settings
 * Uses destructuring to cleanly separate adapter-specific props from known keys
 */
function buildAdapterConfig(
  base: Adapter.Config,
  override: AdapterOverride | undefined,
  globals: ReturnType<typeof buildGlobalSettings>
): Adapter.Config {
  // Destructure to separate known keys from adapter-specific properties
  const { enabled, config, ...adapterSpecific } = override || {};

  return {
    ...base,
    enabled: enabled ?? base.enabled,
    config: {
      ...base.config,
      ...globals,
      ...adapterSpecific,
      ...config
    }
  };
}

// Clean configuration factory  
export function createPNPConfig(input: CreatePnpArgs = {}): GlobalPnpConfig {
  const network = input.network || DEFAULTS.network;
  const isLocal = network === 'local';
  const ports = { ...DEFAULTS.ports, ...input.ports };
  const delegation = { ...DEFAULTS.delegation, ...input.delegation };
  const storage = { ...DEFAULTS.storage, ...input.storage };
  const providers = input.providers || {};
  
  // Computed values
  const hostUrl = isLocal 
    ? `http://127.0.0.1:${ports.replica}`
    : 'https://icp0.io';
    
  const derivationOrigin = providers.frontend && !isLocal
    ? `https://${providers.frontend}.icp0.io`
    : `http://localhost:${ports.frontend}`;

  // Build global settings once - shared across all adapters
  const globals = buildGlobalSettings(
    input,
    network,
    ports,
    delegation,
    storage,
    providers,
    hostUrl,
    derivationOrigin
  );

  // Merge extensions if provided
  const extensionAdapters = input.extensions 
    ? mergeAdapterExtensions(...input.extensions)
    : {};
  
  // Process adapters with simplified merging
  const adapters: Record<string, Adapter.Config> = {};
  const adapterIds = new Set([
    ...Object.keys(Adapters),
    ...Object.keys(extensionAdapters),
    ...Object.keys(input.adapters || {})
  ]);
  
  for (const id of adapterIds) {
    const base = Adapters[id] || extensionAdapters[id];
    const override = input.adapters?.[id];
    
    // Custom adapter without base
    if (!base && override?.adapter) {
      adapters[id] = override as any;
      continue;
    }
    
    if (!base) continue;
    
    // Use helper to merge configuration efficiently
    adapters[id] = buildAdapterConfig(base, override, globals);
  }

  // Return clean global config
  return {
    dfxNetwork: network,
    replicaPort: ports.replica,
    hostUrl,
    delegationTimeout: delegation.timeout,
    delegationTargets: delegation.targets,
    derivationOrigin,
    fetchRootKey: input.security?.fetchRootKey ?? isLocal,
    verifyQuerySignatures: input.security?.verifyQuerySignatures ?? !isLocal,
    localStorageKey: storage.key,
    siwsProviderCanisterId: providers.siws,
    siweProviderCanisterId: providers.siwe,
    adapters
  };
}

// Builder pattern for cleaner configuration
export class ConfigBuilder {
  private config: CreatePnpArgs = {};
  
  static create(): ConfigBuilder {
    return new ConfigBuilder();
  }
  
  withEnvironment(network: 'local' | 'ic', ports?: { replica?: number; frontend?: number }): this {
    this.config.network = network;
    if (ports) this.config.ports = ports;
    return this;
  }
  
  // Named-args friendly API with backward compatibility for positional args
  withDelegation(
    optionsOrTimeout?: { timeout?: bigint; targets?: string[] } | bigint,
    maybeTargets?: string[]
  ): this {
    if (typeof optionsOrTimeout === 'object' && optionsOrTimeout !== null) {
      const { timeout, targets } = optionsOrTimeout;
      this.config.delegation = { timeout, targets };
      return this;
    }
    // Back-compat: (timeout?, targets?)
    const timeout = optionsOrTimeout as bigint | undefined;
    const targets = maybeTargets;
    this.config.delegation = { timeout, targets };
    return this;
  }
  
  withSecurity(fetchRootKey?: boolean, verifyQuerySignatures?: boolean): this {
    this.config.security = { fetchRootKey, verifyQuerySignatures };
    return this;
  }
  
  withProviders(providers: CreatePnpArgs['providers']): this {
    this.config.providers = providers;
    return this;
  }
  
  withExtensions(...extensions: AdapterExtension<any>[]): this {
    this.config.extensions = extensions;
    return this;
  }
  
  withAdapter(id: string, override: AdapterOverride): this {
    if (!this.config.adapters) this.config.adapters = {};
    this.config.adapters[id] = override;
    return this;
  }
  
  /**
   * Quick builder to enable Internet Computer adapters with optional overrides.
   *
   * Usage examples:
   * - withIcAdapters() // enables ii, plug, oisy, nfid
   * - withIcAdapters({ plug: { enabled: true, whitelist: ['canister1'] } })
   * - withIcAdapters({ ii: false }) // disables ii while enabling the rest
   */
  withIcAdapters(
    overrides?: Partial<Record<'ii' | 'plug' | 'oisy' | 'nfid', AdapterOverride | boolean>> & {
      exclude?: Array<'ii' | 'plug' | 'oisy' | 'nfid'>;
    }
  ): this {
    const icIds = ['ii', 'plug', 'oisy', 'nfid'] as const;
    const excluded = new Set(overrides && 'exclude' in overrides ? (overrides.exclude || []) : []);
    if (!this.config.adapters) this.config.adapters = {};
    
    // Normalize overrides to consistent format
    const normalizedOverrides: Record<string, AdapterOverride | null> = {};
    for (const id of icIds) {
      if (excluded.has(id)) {
        normalizedOverrides[id] = null; // Mark as disabled
        continue;
      }
      
      const override = overrides?.[id];
      if (override === undefined) {
        normalizedOverrides[id] = { enabled: true };
      } else if (typeof override === 'boolean') {
        normalizedOverrides[id] = { enabled: override };
      } else {
        normalizedOverrides[id] = { ...override, enabled: override.enabled ?? true };
      }
    }
    
    // Apply normalized overrides
    for (const id of icIds) {
      if (!Adapters[id]) continue;
      
      const normalized = normalizedOverrides[id];
      if (normalized === null) {
        this.config.adapters[id] = { ...(this.config.adapters[id] || {}), enabled: false };
      } else {
        this.config.adapters[id] = { ...(this.config.adapters[id] || {}), ...normalized } as any;
      }
    }
    
    return this;
  }
  
  build(): GlobalPnpConfig {
    return createPNPConfig(this.config);
  }
}

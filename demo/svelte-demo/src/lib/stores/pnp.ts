import { writable, derived, get } from 'svelte/store';
// Import from source for development
import { PNP, ConfigBuilder } from '../../../../../src';
import { fetchBalance } from './ledger';
// ICP-only build: non-IC wallet extensions disabled while migrating to @icp-sdk/core v5.

// Stores
export const pnpInstance = writable<PNP | null>(null);
export const isConnected = writable(false);
export const principalId = writable<string | null>(null);
export const subaccount = writable<string | null>(null);
export const lastEvent = writable<any>(null);
export const connectingWalletId = writable<string | null>(null);
export const error = writable<string | null>(null);
export const availableWallets = derived(pnpInstance, $p => $p?.getEnabledWallets() || []);

// Initialize PNP
const initPNP = () => {
    const pnp = new PNP(
        ConfigBuilder.create()
            .withEnvironment('ic')
            .withDelegation({
                timeout: BigInt(24 * 60 * 60 * 1000 * 1000 * 1000),
                targets: []
            })
            .withIcAdapters()
            .withAdapter('plug', { enabled: true })
            .build()
    );

    pnpInstance.set(pnp);
    
    // Auto-reconnect IC wallets
    const stored = localStorage.getItem('pnpConnectedWallet');
    if (stored) {
        pnp.connect(stored).then(account => {
            if (account) {
                isConnected.set(true);
                principalId.set(account.owner);
                subaccount.set(account.subaccount || null);
                lastEvent.set({ type: 'reconnected', walletId: stored });
                fetchBalance();
            }
        }).catch(() => localStorage.removeItem('pnpConnectedWallet'));
    }
    return pnp;
};

// Helper to reset state
const resetState = () => {
    isConnected.set(false);
    principalId.set(null);
    connectingWalletId.set(null);
};

// Connect wallet
export const connectWallet = async (walletId: string) => {
    const pnp = get(pnpInstance);
    if (!pnp) throw new Error('PNP not initialized');
    
    resetState();
    connectingWalletId.set(walletId);
    lastEvent.set({ type: 'statusChange', status: 'CONNECTING', walletId });

    try {
        const account = await pnp.connect(walletId);
        if (!account) throw new Error("Connection cancelled");
        
        isConnected.set(true);
        principalId.set(account.owner);
        subaccount.set(account.subaccount || null);
        connectingWalletId.set(null);
        lastEvent.set({ type: 'connected', walletId, principal: account.owner });
        localStorage.setItem('pnpConnectedWallet', walletId);
        
        return account;
    } catch (err) {
        resetState();
        lastEvent.set({ type: 'error', message: err.message });
        throw err;
    }
};

// Disconnect wallet
export const disconnectWallet = async () => {
    const pnp = get(pnpInstance);
    if (!pnp) return;

    try {
        await pnp.disconnect();
        resetState();
        localStorage.removeItem('pnpConnectedWallet');
        lastEvent.set({ type: 'disconnected' });
    } catch (err) {
        resetState();
        throw err;
    }
};

// Initialize on load
initPNP();
import { writable, get } from 'svelte/store';
import { Principal } from '@icp-sdk/core/principal';
import { pnpInstance } from './pnp';
import { idlFactory, canisterId } from '../idls/ksicp_ledger';
import type { _SERVICE } from '../idls/ksicp_ledger/ksicp_ledger.did';

export const balance = writable<bigint | null>(null);

export const fetchBalance = async () => {
  const pnp = get(pnpInstance);
  if (!pnp?.account?.owner) return;

  try {
    const actor = pnp.getActor<_SERVICE>({
      canisterId, 
      idl: idlFactory,
      anon: true 
    });
    
    const result = await actor.icrc1_balance_of({
      owner: Principal.fromText(pnp.account.owner),
      subaccount: [],
    });
    balance.set(result);
    return result;
  } catch (error) {
    console.error('Balance fetch failed:', error);
  }
};

import { Actor, HttpAgent } from "@icp-sdk/core/agent";

// Imports and re-exports candid interface
import { idlFactory } from "./ksicp_ledger.did.js";
export { idlFactory } from "./ksicp_ledger.did.js";

// Read from Vite env (process.env doesn't exist in browser). Falls back to
// mainnet ICP ledger if VITE_CANISTER_ID_ICP_LEDGER isn't set.
export const canisterId =
  import.meta.env.VITE_CANISTER_ID_ICP_LEDGER ||
  'ryjl3-tyaaa-aaaaa-aaaba-cai';

// NOTE: The demo uses `pnp.getActor()` (in stores/ledger.ts) which builds a
// properly-configured HttpAgent via PNP. We keep `createActor` for parity with
// dfx-generated bindings but DO NOT auto-evaluate it at module load — that used
// to ship a half-configured agent that fetched root key against window.origin,
// causing a CBOR decode error when the dev server returned index.html instead
// of /api/v2/status from the IC.
export const createActor = (canisterId, options = {}) => {
  const agent = options.agent || new HttpAgent({ ...options.agentOptions });

  if (options.agent && options.agentOptions) {
    console.warn(
      "Detected both agent and agentOptions passed to createActor. Ignoring agentOptions and proceeding with the provided agent."
    );
  }

  // Fetch root key only when caller opts in via agentOptions.host pointing to a
  // local replica. Skip when no host was supplied to avoid hammering the page origin.
  if (import.meta.env.DEV && options.agentOptions?.host) {
    agent.fetchRootKey().catch((err) => {
      console.warn(
        "Unable to fetch root key. Check to ensure that your local replica is running"
      );
      console.error(err);
    });
  }

  return Actor.createActor(idlFactory, {
    agent,
    canisterId,
    ...options.actorOptions,
  });
};

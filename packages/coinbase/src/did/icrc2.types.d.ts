import type { Principal } from "@icp-sdk/core/principal";

export type IcrcNat = bigint;

export type IcrcVec<T> = T[];

export type IcrcOpt<T> = [] | [T];

export interface IcrcAccount {
  owner: Principal;
  subaccount: IcrcOpt<Uint8Array | number[]>;
}

export interface IcrcAllowanceArgs {
  account: IcrcAccount;
  spender: IcrcAccount;
}

export interface IcrcAllowance {
  allowance: IcrcNat;
  expires_at: IcrcOpt<bigint>;
}

export interface IcrcApproveArgs {
  fee: IcrcOpt<IcrcNat>;
  memo: IcrcOpt<Uint8Array | number[]>;
  from_subaccount: IcrcOpt<Uint8Array | number[]>;
  created_at_time: IcrcOpt<bigint>;
  amount: IcrcNat;
  expected_allowance: IcrcOpt<IcrcNat>;
  expires_at: IcrcOpt<bigint>;
  spender: IcrcAccount;
}

export type IcrcApproveError =
  | { GenericError: { message: string; error_code: bigint } }
  | { TemporarilyUnavailable: null }
  | { Duplicate: { duplicate_of: bigint } }
  | { BadFee: { expected_fee: IcrcNat } }
  | { AllowanceChanged: { current_allowance: IcrcNat } }
  | { CreatedInFuture: { ledger_time: bigint } }
  | { TooOld: null }
  | { Expired: { ledger_time: bigint } }
  | { InsufficientFunds: { balance: IcrcNat } };

export type IcrcApproveResult = { Ok: IcrcNat } | { Err: IcrcApproveError };

export interface IcrcTransferArg {
  to: IcrcAccount;
  fee: IcrcOpt<IcrcNat>;
  memo: IcrcOpt<Uint8Array | number[]>;
  from_subaccount: IcrcOpt<Uint8Array | number[]>;
  created_at_time: IcrcOpt<bigint>;
  amount: IcrcNat;
}

export type IcrcTransferError =
  | { GenericError: { message: string; error_code: bigint } }
  | { TemporarilyUnavailable: null }
  | { BadBurn: { min_burn_amount: IcrcNat } }
  | { Duplicate: { duplicate_of: IcrcNat } }
  | { BadFee: { expected_fee: IcrcNat } }
  | { CreatedInFuture: { ledger_time: bigint } }
  | { TooOld: null }
  | { InsufficientFunds: { balance: IcrcNat } };

export type IcrcTransferResult = { Ok: IcrcNat } | { Err: IcrcTransferError };

export interface IcrcTransferFromArgs {
  to: IcrcAccount;
  fee: IcrcOpt<IcrcNat>;
  spender_subaccount: IcrcOpt<Uint8Array | number[]>;
  from: IcrcAccount;
  memo: IcrcOpt<Uint8Array | number[]>;
  created_at_time: IcrcOpt<bigint>;
  amount: IcrcNat;
}

export type IcrcTransferFromError =
  | { GenericError: { message: string; error_code: bigint } }
  | { TemporarilyUnavailable: null }
  | { InsufficientAllowance: { allowance: IcrcNat } }
  | { BadBurn: { min_burn_amount: IcrcNat } }
  | { Duplicate: { duplicate_of: IcrcNat } }
  | { BadFee: { expected_fee: IcrcNat } }
  | { CreatedInFuture: { ledger_time: bigint } }
  | { TooOld: null }
  | { InsufficientFunds: { balance: IcrcNat } };

export type IcrcTransferFromResult = { Ok: IcrcNat } | { Err: IcrcTransferFromError };

export interface IcrcMetadataValue {
  Int?: bigint;
  Nat?: bigint;
  Blob?: Uint8Array | number[];
  Text?: string;
}

export interface IcrcStandardRecord { name: string; url: string }

export interface Icrc2Service {
  // ICRC-1
  icrc1_name: () => Promise<string>;
  icrc1_symbol: () => Promise<string>;
  icrc1_decimals: () => Promise<number>;
  icrc1_metadata: () => Promise<Array<[string, IcrcMetadataValue]>>;
  icrc1_total_supply: () => Promise<IcrcNat>;
  icrc1_fee: () => Promise<IcrcNat>;
  icrc1_minting_account: () => Promise<IcrcOpt<IcrcAccount>>;
  icrc1_balance_of: (account: IcrcAccount) => Promise<IcrcNat>;
  icrc1_transfer: (args: IcrcTransferArg) => Promise<IcrcTransferResult>;
  icrc1_supported_standards: () => Promise<IcrcStandardRecord[]>;

  // ICRC-2
  icrc2_approve: (args: IcrcApproveArgs) => Promise<IcrcApproveResult>;
  icrc2_allowance: (args: IcrcAllowanceArgs) => Promise<IcrcAllowance>;
  icrc2_transfer_from: (args: IcrcTransferFromArgs) => Promise<IcrcTransferFromResult>;
}

export type { Principal };



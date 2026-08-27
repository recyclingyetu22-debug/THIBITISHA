import { request } from "./client.js";

export interface BillingAccount {
  hasAccount: boolean;
  unlimited: boolean;
  balance: number | null;
  updatedAt?: string;
}

export function getBillingAccount(): Promise<BillingAccount> {
  return request<BillingAccount>("/billing/account");
}

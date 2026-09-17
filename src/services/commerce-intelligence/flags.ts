export const commerceFlagNames = [
  'COMMERCE_IDENTITY_GRAPH_ENABLED', 'COMMERCE_VARIANTS_ENABLED',
  'OFFER_LEDGER_ENABLED', 'PRICE_TRUTH_ENABLED', 'TRUST_SIGNALS_ENABLED',
] as const;
export type CommerceFlag = typeof commerceFlagNames[number];
export function commerceEnabled(flag: CommerceFlag, env: Record<string, string | undefined> = process.env): boolean {
  return env[flag]?.trim().toLowerCase() === 'true';
}

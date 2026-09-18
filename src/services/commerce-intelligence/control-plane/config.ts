import { Marketplace } from '@prisma/client';
import { hashToken, validCanaryToken } from './token';

export const distributedCanaryFlagNames = [
  'COMMERCE_DISTRIBUTED_CANARY_ENABLED',
  'COMMERCE_SHADOW_CANARY_TOKEN',
] as const;

export interface DistributedCanaryConfig {
  /** COMMERCE_DISTRIBUTED_CANARY_ENABLED — exact 'true' only (Part E). */
  enabled: boolean;
  /** Validated runtime secret (never logged, never persisted). */
  token?: string;
  tokenHash?: string;
  /** COMMERCE_SHADOW_ENABLED — the distributed gate requires the shadow gate (Part E). */
  shadowEnabled: boolean;
  /** COMMERCE_SHADOW_MARKETPLACE (exact value, shared with 50AG.2 config). */
  marketplace?: Marketplace;
  /** COMMERCE_SHADOW_EXTERNAL_ID (exact value, shared with 50AG.2 config). */
  externalId?: string;
  dryRun: boolean;
}

const exactTrue = (v: string | undefined) => v?.trim().toLowerCase() === 'true';

export function parseDistributedCanaryConfig(env: Record<string, string | undefined>): DistributedCanaryConfig {
  const enabled = exactTrue(env.COMMERCE_DISTRIBUTED_CANARY_ENABLED);
  const token = validCanaryToken(env.COMMERCE_SHADOW_CANARY_TOKEN) ? env.COMMERCE_SHADOW_CANARY_TOKEN : undefined;
  const marketplace = env.COMMERCE_SHADOW_MARKETPLACE?.trim();
  const externalId = env.COMMERCE_SHADOW_EXTERNAL_ID?.trim();
  return {
    enabled,
    token,
    tokenHash: token ? hashToken(token) : undefined,
    shadowEnabled: exactTrue(env.COMMERCE_SHADOW_ENABLED),
    marketplace: Object.values(Marketplace).includes(marketplace as Marketplace) ? (marketplace as Marketplace) : undefined,
    externalId: externalId && /^[A-Za-z0-9_-]{1,128}$/.test(externalId) ? externalId : undefined,
    dryRun: env.COMMERCE_SHADOW_DRY_RUN?.trim().toLowerCase() !== 'false',
  };
}

/** Token presence/validity state used for fail-closed gating (Part AL). */
export function distributedTokenState(env: Record<string, string | undefined>): {
  token?: string; hash?: string; reason: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'OK';
} {
  const token = env.COMMERCE_SHADOW_CANARY_TOKEN;
  if (!token) return { reason: 'TOKEN_MISSING' };
  if (!validCanaryToken(token)) return { reason: 'TOKEN_INVALID' };
  return { token, hash: hashToken(token), reason: 'OK' };
}

/**
 * Local-only target policy for the distributed control plane (mirrors 50AG.2's
 * hard tripwire). Only 127.0.0.1:55433 and never 55432. Production deployment
 * is always forbidden during this mission.
 */
export function localControlPlaneTarget(
  connectionString: string | undefined,
  deploymentEnv: string | undefined,
  extraAllowedDbNames: string[] = [],
): 'PRODUCTION_FORBIDDEN' | 'LOCAL_TARGET_REQUIRED' | null {
  if (deploymentEnv === 'production') return 'PRODUCTION_FORBIDDEN';
  try {
    const u = new URL(connectionString ?? '');
    const allowed = new Set(['ofertano_50ag2_shadow', 'ofertano_50ag3_control_plane', ...extraAllowedDbNames]);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return 'LOCAL_TARGET_REQUIRED';
    if (u.hostname !== '127.0.0.1' || u.port !== '55433') return 'LOCAL_TARGET_REQUIRED';
    const db = u.pathname.replace(/^\//, '');
    if (!allowed.has(db)) return 'LOCAL_TARGET_REQUIRED';
    if (u.search || u.hash) return 'LOCAL_TARGET_REQUIRED';
  } catch {
    return 'LOCAL_TARGET_REQUIRED';
  }
  return null;
}

export function dbNameOf(connectionString: string | undefined): string | undefined {
  try { return new URL(connectionString ?? '').pathname.replace(/^\//, '') || undefined; } catch { return undefined; }
}

/**
 * Future Production activation gate (Part R1): a control plane that is
 * deployed to a non-local environment MUST run DISTRIBUTED_GRANT; the
 * process-local write budget is never sufficient authority for a canary.
 */
export function productionControlModeRequirement(env: Record<string, string | undefined>, deploymentEnv?: string): { ok: boolean; reason?: string } {
  if (deploymentEnv !== 'production') return { ok: true };
  const enabled = exactTrue(env.COMMERCE_DISTRIBUTED_CANARY_ENABLED);
  if (!enabled) return { ok: false, reason: 'PRODUCTION_REQUIRES_DISTRIBUTED_GRANT' };
  if (!exactTrue(env.COMMERCE_SHADOW_ENABLED)) return { ok: false, reason: 'PRODUCTION_SHADOW_GATE_OFF' };
  if (!validCanaryToken(env.COMMERCE_SHADOW_CANARY_TOKEN)) return { ok: false, reason: 'PRODUCTION_TOKEN_INVALID' };
  return { ok: true };
}
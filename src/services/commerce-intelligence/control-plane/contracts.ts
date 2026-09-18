import type { CommerceCanaryGrantStatus, Marketplace, PrismaClient } from '@prisma/client';
import type { CommerceShadowInput, CommerceShadowResult, ShadowDependencies } from '../shadow/contracts';
import type { QueryResultRow } from 'pg';

/** Minimal SQL executor duck-type satisfied by pg Pool/Client and test fakes. */
export interface SqlExecutor {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: R[] }>;
}

/** How the current environment authorizes a canary attempt. */
export type CanaryControlMode = 'LOCAL_PROCESS_BUDGET' | 'DISTRIBUTED_GRANT';

/**
 * Block reasons for the distributed one-shot grant. Fail-closed: any
 * divergent dimension blocks and consumes nothing.
 */
export const canaryBlockReasons = [
  'SHADOW_DISABLED',
  'DISTRIBUTED_DISABLED',
  'PRODUCTION_FORBIDDEN',
  'LOCAL_TARGET_REQUIRED',
  'TOKEN_MISSING',
  'TOKEN_INVALID',
  'MARKETPLACE_MISSING',
  'EXTERNAL_ID_MISSING',
  'MARKETPLACE_MISMATCH',
  'EXTERNAL_ID_MISMATCH',
  'INVALID_INPUT',
  'IDENTITY_NOT_EXACT',
  'DRY_RUN',
  'GRANT_NOT_FOUND',
  'ALREADY_CLAIMED',
  'EXPIRED',
  'DISABLED',
  'CONSUMED',
  'FAILED',
  'ATTEMPTS_EXHAUSTED',
  'DRY_RUN_ONLY',
  'SHADOW_PREFLIGHT_FAILED',
  'CLAIM_UNEXPECTED',
  'FINALIZE_UNEXPECTED',
] as const;
export type CanaryBlockReason = typeof canaryBlockReasons[number];

/** Structured, secret-safe control plane events (Part Q). */
export type ControlPlaneEvent = {
  event:
    | 'COMMERCE_CANARY_GRANT_BLOCKED'
    | 'COMMERCE_CANARY_GRANT_CLAIMED'
    | 'COMMERCE_CANARY_CONSUMED'
    | 'COMMERCE_CANARY_FAILED';
  marketplace: string;
  externalIdSafe: string;
  status?: CommerceCanaryGrantStatus;
  reason: string;
  grantId?: string;
  executionId?: string;
  resultObservationId?: string;
  resultStatus?: string;
  durationMs: number;
};

export interface DistributedCanaryInput extends CommerceShadowInput {}

/**
 * Dependencies for the distributed orchestrator. `connectionString` addresses
 * the CONTROL PLANE database (grants + audit). The same database is the local
 * shadow write target for this mission's integration proof; the targets are
 * validated against the local-only policy before any read/write.
 */
export interface DistributedCanaryDependencies {
  env?: Record<string, string | undefined>;
  deploymentEnv?: string;
  connectionString?: string;
  /** Optional injected executor (pg Client/Pool) for tests; defaults to a lazy pool. */
  getExecutor?: () => SqlExecutor;
  log?: (event: ControlPlaneEvent) => void;
  executionId?: string;
  /** Extra local-only DB path names the shadow write may target (fail-closed opt-in). */
  localDbNames?: string[];
  shadowDeps?: Pick<ShadowDependencies, 'budget' | 'log'>;
}

export interface DistributedCanaryResult {
  mode: CanaryControlMode;
  status: 'NOT_DISTRIBUTED' | 'BLOCKED' | 'DRY_RUN' | 'CREATED' | 'DEDUPED' | 'FAILED';
  reason: string;
  claimSucceeded: boolean;
  grantId?: string;
  grantStatus?: CommerceCanaryGrantStatus;
  executionId?: string;
  shadow?: CommerceShadowResult;
  writesPerformed: number;
  durationMs: number;
}

export interface ClaimSuccessGrant {
  id: string;
  status: 'CLAIMED';
  claimedBy: string;
  attemptsClaimed: number;
  expiresAt: Date;
}

export type ClaimOutcome =
  | { success: true; grant: ClaimSuccessGrant }
  | { success: false; reason: CanaryBlockReason; grantId?: string; grantStatus?: CommerceCanaryGrantStatus };

export interface FinalizeInput {
  grantId: string;
  executionId: string;
  finalStatus: 'CONSUMED' | 'FAILED';
  failureCode?: string;
  resultObservationId?: string;
  resultStatus?: string;
}

export type FinalizeOutcome =
  | { applied: true; status: 'CONSUMED' | 'FAILED' }
  | { applied: false; reason: 'ALREADY_FINALIZED' | 'NOT_CLAIMED' | 'NOT_CLAIMANT' | 'NOT_FOUND'; status?: CommerceCanaryGrantStatus };

export interface GrantDraft {
  tokenHash: string;
  marketplace: Marketplace;
  externalId: string;
  expiresAt: Date;
  maxAttempts?: number;
  dryRunOnly?: boolean;
  requireExactIdentity?: boolean;
  metadata?: Record<string, unknown>;
}
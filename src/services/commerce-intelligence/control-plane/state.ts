import type { CommerceCanaryGrantStatus } from '@prisma/client';

/**
 * Distributed canary grant state machine (Part C).
 *
 * Valid transitions:
 *   ARMED   -> CLAIMED   (atomic global claim)
 *   CLAIMED -> CONSUMED  (authorized execution finished CREATED/DEDUPED)
 *   CLAIMED -> FAILED    (authorized execution failed — never auto-retried)
 *   ARMED   -> DISABLED  (explicit operator action)
 *   ARMED   -> EXPIRED   (controlled expiry; claim also treats expiry semantically)
 *
 * There is NO automatic path back from FAILED / CONSUMED / CLAIMED / DISABLED /
 * EXPIRED to ARMED. A failed canary requires a NEW explicit grant/token.
 * Fail closed.
 */
export const CANARY_TRANSITIONS: Readonly<Record<CommerceCanaryGrantStatus, ReadonlyArray<CommerceCanaryGrantStatus>>> = {
  ARMED: ['CLAIMED', 'DISABLED', 'EXPIRED'],
  CLAIMED: ['CONSUMED', 'FAILED'],
  CONSUMED: [],
  FAILED: [],
  EXPIRED: [],
  DISABLED: [],
};

export function canTransition(from: CommerceCanaryGrantStatus, to: CommerceCanaryGrantStatus): boolean {
  return CANARY_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Terminal statuses that permanently forbid any attempt. */
export const CANARY_TERMINAL: ReadonlySet<CommerceCanaryGrantStatus> = new Set(['CONSUMED', 'FAILED', 'EXPIRED', 'DISABLED']);

export function isTerminal(status: CommerceCanaryGrantStatus): boolean {
  return CANARY_TERMINAL.has(status);
}

/** Claim is possible only from ARMED (status gate), with all other checks in SQL. */
export function claimableStatus(status: CommerceCanaryGrantStatus): boolean {
  return status === 'ARMED';
}

export { isTerminal as canaryIsTerminal };
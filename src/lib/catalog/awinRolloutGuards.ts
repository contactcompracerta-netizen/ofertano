/** Security and phase gates for the real AWIN catalog acquisition endpoint. */
export type AwinRolloutPhase = "SHADOW" | "CANARY" | "LIVE";
export type AwinRolloutEnvironment = {
  AWIN_WAVE1_WRITE_ENABLED?: string;
  AWIN_WAVE1_LIVE_ENABLED?: string;
};

export function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** All deployments, including previews, require the cron bearer secret. */
export function isAwinCronAuthorized(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  return Boolean(secret) && authorization === `Bearer ${secret}`;
}

/** SHADOW is read-only for Product/Offer; CANARY and LIVE need explicit flags. */
export function isAwinPhaseEnabled(
  phase: AwinRolloutPhase,
  env: AwinRolloutEnvironment,
): boolean {
  if (phase === "SHADOW") return true;
  if (!isEnabled(env.AWIN_WAVE1_WRITE_ENABLED)) return false;
  return phase === "CANARY" || isEnabled(env.AWIN_WAVE1_LIVE_ENABLED);
}

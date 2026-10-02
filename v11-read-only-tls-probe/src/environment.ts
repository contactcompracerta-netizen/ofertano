// V11 Read-Only TLS Probe — Environment Validation
// Phase: Environment Guard (FASE 11)

import { EXPECTED_ENVIRONMENT, PRODUCTION_SIGNALS } from "./constants.js";

export interface EnvironmentResult {
  isProductionDetected: boolean;
  environmentSignals: string[];
  mismatchDetected: boolean;
  abortReason?: string;
}

/**
 * Detect whether the current environment is Production.
 * Uses explicit Vercel environment signals. Never assumes Production.
 */
export function detectEnvironment(): EnvironmentResult {
  const signals: string[] = [];

  const vercelEnv = process.env.VERCEL_ENV ?? "";
  const vercelTargetEnv = process.env.VERCEL_TARGET_ENV ?? "";

  if (vercelEnv) signals.push(`VERCEL_ENV=${vercelEnv}`);
  if (vercelTargetEnv) signals.push(`VERCEL_TARGET_ENV=${vercelTargetEnv}`);

  const isProductionDetected =
    vercelEnv === "production" && vercelTargetEnv === "production";

  // If the code is configured to require Production but signals don't match
  const requireProduction = process.env.V11_REQUIRE_PRODUCTION === "true";
  let mismatchDetected = false;
  let abortReason: string | undefined;

  if (requireProduction && !isProductionDetected) {
    mismatchDetected = true;
    abortReason = `ENVIRONMENT_MISMATCH: Expected ${EXPECTED_ENVIRONMENT}, got ${vercelEnv}/${vercelTargetEnv}`;
  }

  // If we're in dry-run mode, do not enforce environment
  if (process.env.V11_DRY_RUN === "1") {
    return {
      isProductionDetected: false,
      environmentSignals: signals,
      mismatchDetected: false,
      abortReason: undefined,
    };
  }

  return {
    isProductionDetected,
    environmentSignals: signals,
    mismatchDetected,
    abortReason,
  };
}

/**
 * Validate that the environment is unambiguous before proceeding.
 * Returns ABORT if the environment is inconsistent.
 */
export function validateEnvironment(): EnvironmentResult {
  const result = detectEnvironment();

  if (result.mismatchDetected) {
    return result; // ABORT: inconsistent environment
  }

  // If V11_REQUIRE_PRODUCTION is set but not in production, fail-closed
  if (process.env.V11_REQUIRE_PRODUCTION === "true" && !result.isProductionDetected) {
    result.abortReason = `FAIL_CLOSED: Environment is not ${EXPECTED_ENVIRONMENT}`;
    return result;
  }

  return result;
}

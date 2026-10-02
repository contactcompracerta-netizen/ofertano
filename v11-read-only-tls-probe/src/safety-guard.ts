// V11 Read-Only TLS Probe — Safety Guard
// FASE 3: Hard Safety Boundary + FASE 8: Read-Only Session Defense

import { FORBIDDEN_PATTERNS, FORBIDDEN_SUBPROCESS } from "./constants.js";

export interface SafetyScanResult {
  safe: boolean;
  violations: string[];
}

/**
 * Scan source code text for forbidden patterns.
 * This is the structural guard that prevents any write operations.
 */
export function scanSourceForViolations(sourceCode: string): SafetyScanResult {
  const violations: string[] = [];
  const lines = sourceCode.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const pattern of FORBIDDEN_PATTERNS) {
      // Case-insensitive search for forbidden SQL patterns in actual code
      const regex = new RegExp(pattern.replace(/\s+/g, "\\s+"), "i");
      if (regex.test(line)) {
        // Skip comments that are part of our security documentation
        if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
          violations.push(
            `Line ${lineNum}: Contains forbidden pattern "${pattern}"`
          );
        }
      }
    }

    for (const subpattern of FORBIDDEN_SUBPROCESS) {
      if (line.includes(subpattern)) {
        if (!line.trim().startsWith("//")) {
          violations.push(
            `Line ${lineNum}: Contains forbidden subprocess pattern "${subpattern}"`
          );
        }
      }
    }
  }

  return { safe: violations.length === 0, violations };
}

/**
 * Verify that the V11 source code does not contain any child_process usage.
 * Returns true if no child_process, exec, spawn, or similar imports found.
 */
export function verifyNoSubprocess(sourceCode: string): boolean {
  const dangerousImports = [
    /from\s+['"]node:child_process['"]/,
    /from\s+['"]child_process['"]/,
    /require\(['"]child_process['"]\)/,
    /require\(['"]node:child_process['"]\)/,
  ];

  return !dangerousImports.some((pattern) => pattern.test(sourceCode));
}

/**
 * Verify that the V11 source code does not contain any migration command strings.
 */
export function verifyNoMigrationCommands(sourceCode: string): boolean {
  const migrationPatterns = [
    /migrate\s+deploy/,
    /migrate\s+dev/,
    /db\s+push/,
    /prisma\s+seed/,
    /execFileSync.*prisma/,
    /execSync.*prisma/,
  ];

  return !migrationPatterns.some((pattern) => pattern.test(sourceCode));
}

/**
 * Full safety scan of a source file.
 */
export function fullSafetyScan(sourceCode: string, filename: string): SafetyScanResult {
  const violations = scanSourceForViolations(sourceCode).violations;

  if (!verifyNoSubprocess(sourceCode)) {
    violations.push(`${filename}: Contains child_process import`);
  }

  if (!verifyNoMigrationCommands(sourceCode)) {
    violations.push(`${filename}: Contains migration command`);
  }

  return { safe: violations.length === 0, violations };
}

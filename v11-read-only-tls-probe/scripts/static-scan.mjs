#!/usr/bin/env node
// V11 Read-Only TLS Probe — Static Safety Scan
// FASE 13: Auditoria Automática
// Scans V11 source code for forbidden patterns.
// Fails if any structural violation is found.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SRC_DIR = join(process.cwd(), "src");
const FORBIDDEN_PATTERNS = [
  /migrate\s+deploy/i,
  /db\s+push/i,
  /migrate\s+dev/i,
  /prisma\s+seed/i,
  /INSERT\s+INTO/i,
  /\bUPDATE\s+\w+\s+SET/i,
  /\bDELETE\s+FROM/i,
  /\bUPSERT\b/i,
  /CREATE\s+TABLE/i,
  /ALTER\s+TABLE/i,
  /DROP\s+TABLE/i,
  /TRUNCATE\s+TABLE/i,
  /COPY\s+FROM/i,
  /\bMERGE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
];

const FORBIDDEN_SUBPROCESS = [
  /execSync?\s*\(/,
  /spawn(?:Sync)?\s*\(/,
];

function scanFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const violations = [];
  const lines = content.split("\n");

  // Track if we're inside a const array definition that defines forbidden patterns
  let inConstArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }

    // Track const array boundaries for safety definitions
    if (/export\s+const\s+(FORBIDDEN_PATTERNS|FORBIDDEN_SUBPROCESS)\s*=\s*\[/.test(line) ||
        /^\s*const\s+(FORBIDDEN_PATTERNS|FORBIDDEN_SUBPROCESS)\s*=\s*\[/.test(line)) {
      inConstArray = true;
      continue;
    }
    if (inConstArray && line.includes("] as const")) {
      inConstArray = false;
      continue;
    }
    if (inConstArray) {
      continue;
    }

    // Also skip lines in constants.ts that define string arrays
    if (filePath.includes("constants.ts") && trimmed.startsWith('"')) {
      continue;
    }
    // Also skip v11-probe.ts constant definitions
    if (filePath.includes("v11-probe.ts") && trimmed.startsWith('"')) {
      continue;
    }

    // Skip string array definitions that are constants (not executable code)
    // e.g., line that starts with a string literal inside an array
    if (trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`")) {
      // Skip query allowlist constants
      if (line.includes("SELECT ssl FROM pg_stat_ssl") ||
          line.includes("SELECT current_setting") ||
          line.includes("SELECT 1 AS v11_probe")) {
        continue;
      }
    }

    // Skip constant definition lines for safety arrays
    if (trimmed.includes("FORBIDDEN_PATTERNS") && trimmed.includes("[")) {
      continue;
    }
    if (trimmed.includes("FORBIDDEN_SUBPROCESS") && trimmed.includes("[")) {
      continue;
    }

    // Check for actual executable forbidden SQL patterns
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        // Skip test files' assertion lines
        if (filePath.includes("/tests/") && isTestAssertion(line)) {
          continue;
        }
        violations.push(`Line ${lineNum}: SQL write pattern detected`);
      }
    }

    // Check for subprocess calls (actual executable code only)
    // Skip lines that are importing or defining patterns
    if (!filePath.includes("/tests/")) {
      for (const pattern of FORBIDDEN_SUBPROCESS) {
        if (pattern.test(line)) {
          // Skip if it's defining the forbidden list, not using it
          if (line.includes("FORBIDDEN_SUBPROCESS") && line.includes("[")) continue;
          if (line.includes('"child_process"') || line.includes("'child_process'")) continue;
          violations.push(`Line ${lineNum}: subprocess call detected`);
        }
      }

      // Special check: child_process import in source files is forbidden
      if (/from\s+['"]node:child_process['"]/.test(line) || /from\s+['"]child_process['"]/.test(line)) {
        violations.push(`Line ${lineNum}: child_process import`);
      }
    }
  }

  return { file: filePath, violations };
}

function isTestAssertion(line) {
  return (
    line.includes("expect(") &&
    (line.includes("reject") || line.includes("false") || line.includes("throw"))
  );
}

function scanDirectory(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))) {
      results.push(scanFile(fullPath));
    }
  }

  return results;
}

function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  V11 STATIC SAFETY SCAN");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");

  const results = scanDirectory(SRC_DIR);

  let totalViolations = 0;
  const allHashes = [];

  for (const result of results) {
    const content = readFileSync(result.file, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");
    allHashes.push({ file: result.file, sha256: hash });

    if (result.violations.length > 0) {
      console.error(`❌ ${result.file}:`);
      for (const v of result.violations) {
        console.error(`   ${v}`);
      }
      totalViolations += result.violations.length;
    } else {
      console.log(`✅ ${result.file}`);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Files scanned: ${results.length}`);
  console.log(`  Total violations: ${totalViolations}`);
  console.log("");

  console.log("─── FILE HASHES (for audit trail) ───");
  for (const h of allHashes) {
    console.log(`${h.sha256.substring(0, 16)}  ${h.file}`);
  }
  console.log("");

  if (totalViolations > 0) {
    console.error("❌ STATIC SAFETY SCAN FAILED");
    process.exit(1);
  } else {
    console.log("✅ STATIC SAFETY SCAN PASSED");
  }
}

main();

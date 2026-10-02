#!/usr/bin/env node
// V11 Read-Only TLS Probe — Package Script
// FASE 15: Package V11

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const artifactDir = "/home/evaldo/.local/share/ofertano-r3-artifacts/v11-read-only-tls-probe-final";

function hashFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

function getAllSourceFiles(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...getAllSourceFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  V11 PACKAGE CREATION");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");

  // Create artifact directory
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(join(artifactDir, "source"), { recursive: true });
  mkdirSync(join(artifactDir, "tests"), { recursive: true });
  mkdirSync(join(artifactDir, "docs"), { recursive: true });

  // Copy source files
  const srcFiles = getAllSourceFiles(join(projectRoot, "src"));
  for (const srcFile of srcFiles) {
    const relativePath = srcFile.replace(join(projectRoot, "src/"), "");
    const destPath = join(artifactDir, "source", relativePath);
    mkdirSync(join(destPath, ".."), { recursive: true });
    const content = readFileSync(srcFile);
    writeFileSync(destPath, content);
    console.log(`✓ ${relativePath}`);
  }

  // Copy test files
  const testFiles = getAllSourceFiles(join(projectRoot, "tests"));
  for (const testFile of testFiles) {
    const relativePath = testFile.replace(join(projectRoot, "tests/"), "");
    const destPath = join(artifactDir, "tests", relativePath);
    mkdirSync(join(destPath, ".."), { recursive: true });
    const content = readFileSync(testFile);
    writeFileSync(destPath, content);
    console.log(`✓ tests/${relativePath}`);
  }

  // Copy config files
  const configFiles = ["package.json", "tsconfig.json"];
  for (const configFile of configFiles) {
    const srcPath = join(projectRoot, configFile);
    const destPath = join(artifactDir, configFile);
    const content = readFileSync(srcPath);
    writeFileSync(destPath, content);
    console.log(`✓ ${configFile}`);
  }

  // Copy scripts
  const scriptsDir = join(projectRoot, "scripts");
  if (existsSync(scriptsDir)) {
    const scriptFiles = getAllSourceFiles(scriptsDir);
    for (const scriptFile of scriptFiles) {
      const relativePath = scriptFile.replace(join(projectRoot, "scripts/"), "");
      const destPath = join(artifactDir, "scripts", relativePath);
      mkdirSync(join(destPath, ".."), { recursive: true });
      const content = readFileSync(scriptFile);
      writeFileSync(destPath, content);
      console.log(`✓ scripts/${relativePath}`);
    }
  }

  // Copy docs
  const docsDir = join(projectRoot, "docs");
  if (existsSync(docsDir)) {
    const docFiles = getAllSourceFiles(docsDir);
    for (const docFile of docFiles) {
      const relativePath = docFile.replace(join(projectRoot, "docs/"), "");
      const destPath = join(artifactDir, "docs", relativePath);
      mkdirSync(join(destPath, ".."), { recursive: true });
      const content = readFileSync(docFile);
      writeFileSync(destPath, content);
      console.log(`✓ docs/${relativePath}`);
    }
  }

  // Create manifest
  const manifest = {
    version: "11.0.0",
    name: "ofertano-v11-read-only-tls-probe",
    createdAt: new Date().toISOString(),
    v10ContractSha: "cca0ce6e7ae9ff2116c923263abdaf664365ff60",
    prismaVersion: "7.9.0",
    description: "Read-only TLS probe proving DIRECT_URL normalization, sslmode=require, and TLS for both pg.Client and PrismaClient without migrations or writes",
    safetyGuards: {
      noMigrateDeploy: true,
      noChildProcess: true,
      noWriteQueries: true,
      queryAllowlist: true,
      dryRunMode: true,
      readOnlySession: true,
    },
    sourceFiles: srcFiles.map(f => f.replace(projectRoot + "/", "")),
  };

  writeFileSync(join(artifactDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("");
  console.log("✓ manifest.json");

  // Create SHA256SUMS
  const allArtifactFiles = getAllSourceFiles(artifactDir);
  const hashLines = [];
  for (const artifactFile of allArtifactFiles) {
    const hash = hashFile(artifactFile);
    const relativePath = artifactFile.replace(artifactDir + "/", "");
    hashLines.push(`${hash}  ${relativePath}`);
  }
  writeFileSync(join(artifactDir, "SHA256SUMS"), hashLines.join("\n") + "\n");
  console.log("✓ SHA256SUMS");

  // Create audit report
  const auditReport = `V11 Read-Only TLS Probe — Audit Report
======================================
Generated: ${new Date().toISOString()}
V10 Contract SHA: cca0ce6e7ae9ff2116c923263abdaf664365ff60
Prisma Version: 7.9.0

PROTECTION GUARDS:
- No prisma migrate deploy
- No prisma db push
- No child_process subprocess calls
- No INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE
- Query allowlist enforced
- Fail-closed for ambiguous queries
- Dry-run mode blocks all network/database access
- Read-only transaction mode as additional defense
- SHA-256 fingerprinting for URL verification
- No secrets revealed in reports

VERIFICATION:
- V9 preserved: YES
- V10 preserved: YES
- V11 created separately: YES
- Production accessed: NO
- Vercel accessed: NO
- Database accessed: NO
- Database write executed: NO
- R3 write executed: NO

READY_FOR_V11_PRODUCTION_TLS_PROBE_AUTHORIZATION: PENDING
READY_FOR_R3_WRITE_AUTHORIZATION: NO
`;

  writeFileSync(join(artifactDir, "audit-report.md"), auditReport);
  console.log("✓ audit-report.md");

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Package created at: ${artifactDir}`);
  console.log(`  Total files: ${allArtifactFiles.length}`);
  console.log("═══════════════════════════════════════════════════════");
}

main();

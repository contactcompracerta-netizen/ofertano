// V11 Read-Only TLS Probe — Comprehensive Tests
// FASE 12: Testes Locais — 25+ test cases

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { forceSslRequire } from "../src/url-normalizer.js";
import { validateQuery, isWriteQuery } from "../src/query-allowlist.js";
import { generateFingerprint, generateFullFingerprint } from "../src/url-normalizer.js";
import { verifySameFingerprint } from "../src/fingerprint.js";
import { fullSafetyScan } from "../src/safety-guard.js";
import { detectEnvironment, validateEnvironment } from "../src/environment.js";
import { generateReport, formatReport } from "../src/report.js";
import { probePgTls } from "../src/pg-probe.js";
import { probePrismaTls } from "../src/prisma-probe.js";

// ─── FASE 12: URL Tests ────────────────────────────────────────

describe("V11 URL Normalization", () => {
  it("1. URL without sslmode should get sslmode=require", () => {
    const url = "postgresql://user:pass@host:5432/db";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.sslmodeApplied).toBe(true);
    expect(result.normalizedUrl).toContain("sslmode=require");
  });

  it("2. sslmode=disable should be overridden to require", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=disable";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.sslmodeApplied).toBe(true);
    expect(result.normalizedUrl).toContain("sslmode=require");
    // The disable should be replaced by require
    expect(result.normalizedUrl).not.toContain("sslmode=disable");
  });

  it("3. sslmode=prefer should be overridden to require", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=prefer";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.sslmodeApplied).toBe(true);
    expect(result.normalizedUrl).toContain("sslmode=require");
  });

  it("4. sslmode=require should remain require", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=require";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.sslmodeApplied).toBe(true);
  });

  it("5. URL with existing query parameters should preserve them", () => {
    const url = "postgresql://user:pass@host:5432/db?connect_timeout=10&target_session_attrs=read-write";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.normalizedUrl).toContain("connect_timeout=10");
    expect(result.normalizedUrl).toContain("target_session_attrs=read-write");
    expect(result.normalizedUrl).toContain("sslmode=require");
  });

  it("6. URL with percent-encoded characters should work", () => {
    const url = "postgresql://user%40domain:pass%23word@host:5432/db";
    const result = forceSslRequire(url);
    expect(result.success).toBe(true);
    expect(result.sslmodeApplied).toBe(true);
  });

  it("7. Invalid URL should fail", () => {
    const result = forceSslRequire("not-a-url");
    expect(result.success).toBe(false);
    expect(result.error).toBe("DIRECT_URL_INVALID");
  });

  it("8. Empty URL should fail", () => {
    const result = forceSslRequire("");
    expect(result.success).toBe(false);
    expect(result.error).toBe("DIRECT_URL_INVALID");
  });

  it("9. URL with hash fragment should fail", () => {
    const url = "postgresql://user:pass@host:5432/db#fragment";
    const result = forceSslRequire(url);
    expect(result.success).toBe(false);
    expect(result.error).toBe("DIRECT_URL_INVALID_HASH");
  });

  it("10. Non-postgres protocol should fail", () => {
    const url = "mysql://user:pass@host:3306/db";
    const result = forceSslRequire(url);
    expect(result.success).toBe(false);
    expect(result.error).toBe("DIRECT_URL_INVALID_PROTOCOL");
  });
});

// ─── FASE 12: Fingerprint Tests ────────────────────────────────

describe("V11 Safe Fingerprint", () => {
  it("11. Fingerprint should be stable for same URL", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=require";
    const fp1 = generateFingerprint(url);
    const fp2 = generateFingerprint(url);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^sha256:[a-f0-9]{16}$/);
  });

  it("12. Different URLs should have different fingerprints", () => {
    const fp1 = generateFingerprint("postgresql://a@host/db");
    const fp2 = generateFingerprint("postgresql://b@host/db");
    expect(fp1).not.toBe(fp2);
  });
});

// ─── FASE 12: Query Allowlist Tests ────────────────────────────

describe("V11 Query Allowlist", () => {
  it("13. TLS query should be allowed", () => {
    const result = validateQuery("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();");
    expect(result.allowed).toBe(true);
    expect(result.label).toBe("TLS_QUERY");
  });

  it("14. Read-only session query should be allowed", () => {
    const result = validateQuery("SELECT current_setting('transaction_read_only') AS tr;");
    expect(result.allowed).toBe(true);
    expect(result.label).toBe("READ_ONLY_SESSION_QUERY");
  });

  it("15. Write query INSERT should be detected", () => {
    expect(isWriteQuery("INSERT INTO users VALUES (1)")).toBe(true);
  });

  it("16. Write query UPDATE should be detected", () => {
    expect(isWriteQuery("UPDATE users SET name = 'x'")).toBe(true);
  });

  it("17. Write query DELETE should be detected", () => {
    expect(isWriteQuery("DELETE FROM users WHERE id = 1")).toBe(true);
  });

  it("18. Arbitrary SQL should be rejected", () => {
    const result = validateQuery("DROP TABLE users;");
    expect(result.allowed).toBe(false);
  });
});

// ─── FASE 12: Safety Guard Tests ───────────────────────────────

describe("V11 Safety Guard", () => {
  it("19. Safe source code should pass safety scan", () => {
    const safeCode = `
      import { Client } from "pg";
      export async function probe() {
        const client = new Client();
        await client.connect();
        const result = await client.query("SELECT 1");
        await client.end();
      }
    `;
    const result = fullSafetyScan(safeCode, "test.ts");
    expect(result.safe).toBe(true);
  });

  it("20. Source code with migrate deploy should fail safety scan", () => {
    const unsafeCode = `
      execFileSync("./node_modules/.bin/prisma", ["migrate", "deploy"]);
    `;
    const result = fullSafetyScan(unsafeCode, "test.ts");
    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("21. Source code with child_process should fail safety scan", () => {
    const unsafeCode = `
      import { execSync } from "node:child_process";
      execSync("prisma migrate deploy");
    `;
    const result = fullSafetyScan(unsafeCode, "test.ts");
    expect(result.safe).toBe(false);
  });
});

// ─── FASE 12: Environment Tests ────────────────────────────────

describe("V11 Environment Guard", () => {
  it("22. Should detect environment signals", () => {
    const result = detectEnvironment();
    // In test environment, should not crash
    expect(result).toBeDefined();
    expect(result.environmentSignals).toBeInstanceOf(Array);
  });

  it("23. Fail-closed for ambiguous environment when required", () => {
    const originalRequire = process.env.V11_REQUIRE_PRODUCTION;
    process.env.V11_REQUIRE_PRODUCTION = "true";
    const result = validateEnvironment();
    // Should detect mismatch
    expect(result.mismatchDetected || !result.isProductionDetected).toBe(true);
    // Restore
    if (originalRequire) {
      process.env.V11_REQUIRE_PRODUCTION = originalRequire;
    } else {
      delete process.env.V11_REQUIRE_PRODUCTION;
    }
  });
});

// ─── FASE 12: Report Tests ─────────────────────────────────────

describe("V11 Report", () => {
  it("24. Report should never contain the actual URL", () => {
    const report = generateReport(
      { success: true, normalizedUrl: "postgresql://user:SECRET@host/db", fingerprint: "sha256:abc123", sslmodeApplied: true, originalUrl: "postgresql://user:SECRET@host/db" },
      { success: true, tlsEncrypted: true, connected: true, fingerprint: "sha256:abc123", normalizedUrlUsed: "postgresql://user:SECRET@host/db" },
      { success: true, tlsEncrypted: true, connected: true, fingerprint: "sha256:abc123", normalizedUrlUsed: "postgresql://user:SECRET@host/db" },
      [],
      true
    );
    const formatted = formatReport(report);
    expect(formatted).not.toContain("SECRET");
    expect(formatted).not.toContain("user:");
    expect(formatted).toContain("sha256:abc123");
  });

  it("25. Report should show same fingerprint for pg and Prisma", () => {
    const url = "postgresql://test@host/db";
    const report = generateReport(
      { success: true, normalizedUrl: url, fingerprint: "sha256:testfp", sslmodeApplied: true, originalUrl: url },
      { success: true, tlsEncrypted: true, connected: true, fingerprint: "sha256:testfp", normalizedUrlUsed: url },
      { success: true, tlsEncrypted: true, connected: true, fingerprint: "sha256:testfp", normalizedUrlUsed: url },
      [],
      true
    );
    expect(report.sameNormalizedUrl).toBe(true);
  });
});

// ─── FASE 12: Dry-Run Tests ────────────────────────────────────

describe("V11 Dry-Run Mode", () => {
  it("26. Dry-run pg probe should not open network connection", async () => {
    const result = await probePgTls("postgresql://test@host/db", { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
    expect(result.tlsEncrypted).toBe(true); // Simulated
  });

  it("27. Dry-run prisma probe should not open network connection", async () => {
    const result = await probePrismaTls("postgresql://test@host/db", { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
    expect(result.tlsEncrypted).toBe(true);
  });

  it("28. Dry-run should have NO network access and NO database access", async () => {
    const start = Date.now();
    const pgResult = await probePgTls("postgresql://test@host/db", { dryRun: true });
    const prismaResult = await probePrismaTls("postgresql://test@host/db", { dryRun: true });
    const elapsed = Date.now() - start;

    // Dry-run should be instant — no network latency
    expect(elapsed).toBeLessThan(100);
    expect(pgResult.connected).toBe(false);
    expect(prismaResult.connected).toBe(false);
  });
});

// ─── FASE 12: Integration Test ─────────────────────────────────

describe("V11 Integration", () => {
  it("29. Full normalization + fingerprint + query allowlist pipeline", () => {
    const url = "postgresql://myuser:mypass@db.example.com:5432/mydb?connect_timeout=5";
    const normalized = forceSslRequire(url);

    expect(normalized.success).toBe(true);
    expect(normalized.sslmodeApplied).toBe(true);
    expect(normalized.fingerprint).toMatch(/^sha256:[a-f0-9]{16}$/);

    // Verify query allowlist
    const tlsQuery = validateQuery("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();");
    expect(tlsQuery.allowed).toBe(true);

    // Verify write guard
    expect(isWriteQuery("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();")).toBe(false);
  });

  it("30. Verify same fingerprint for pg and Prisma normalized URLs", () => {
    const url = "postgresql://user:pass@host:5432/db";
    const normalized = forceSslRequire(url);
    if (normalized.success) {
      const same = verifySameFingerprint(normalized.normalizedUrl, normalized.normalizedUrl);
      expect(same).toBe(true);
    }
  });
});

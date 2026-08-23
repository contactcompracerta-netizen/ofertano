/**
 * Verifica arquivos textuais do Ofertano em busca de mojibake
 * (UTF-8 interpretado como Latin-1/Windows-1252, inclusive dupla
 * codificação). Falha com exit code 1 se encontrar corrupção real.
 *
 * Preserva português correto em UTF-8, inclusive a palavra Âmbar.
 * A letra Â só é tratada como erro quando vier seguida de um
 * caractere de faixa alta típico de mojibake, nunca em Âmbar.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
  ".turbo",
  ".vercel",
  ".agents",
  ".claude",
  ".windsurf",
  "backups",
]);

const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".svg",
  ".mp4",
  ".webm",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".pack",
  ".mp3",
  ".wav",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".prisma",
  ".sql",
  ".md",
  ".mdc",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
]);

const SKIP_FILES = new Set(["log.txt"]);

const CP1252_HIGH =
  "\\u0080-\\u00BF\\u0152\\u0153\\u0160\\u0161\\u0178\\u017D\\u017E" +
  "\\u0192\\u02C6\\u02DC\\u2013\\u2014\\u2018-\\u201E\\u2020-\\u2022" +
  "\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122";

/**
 * Padrões fortes de mojibake, montados com escapes Unicode para este
 * arquivo não conter as sequências corrompidas.
 *
 * - U+00C3 + byte alto: UTF-8 de Latin-1 lido como CP1252.
 * - U+00C3 + U+0192: prefixo de dupla codificação, e também mojibake
 *   simples de A-til maiúsculo.
 * - U+00E2 + U+20AC: travessão/aspas UTF-8 lidos como CP1252.
 * - U+FFFD: caractere de substituição.
 * - U+00C2 + byte alto: UTF-8 C2 xx lido como CP1252. Não casa Âmbar
 *   porque a letra seguinte é ASCII.
 */
const MOJIBAKE_RE = new RegExp(
  [
    `\\u00C3[${CP1252_HIGH}]`,
    `\\u00C2[${CP1252_HIGH}\\u00A0-\\u00FF]`,
    "\\u00E2\\u20AC",
    "\\uFFFD",
  ].join("|"),
  "g",
);

function isBackup(rel) {
  return rel.includes(".bak");
}

function shouldSkipFile(rel, name) {
  if (SKIP_FILES.has(name)) return true;
  if (isBackup(rel)) return true;
  if (name.endsWith(".log")) return true;
  if (name.startsWith("_") && rel.replaceAll("\\", "/").startsWith("scripts/")) {
    return true;
  }
  return false;
}

function isTextFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (name === "Dockerfile") return true;
  return false;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).replaceAll("\\", "/");

    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(abs, acc);
      continue;
    }

    if (shouldSkipFile(rel, ent.name)) continue;
    if (SKIP_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    if (!isTextFile(ent.name)) continue;
    acc.push(rel);
  }

  return acc;
}

function snippetAround(line, index, length) {
  const start = Math.max(0, index - 24);
  const end = Math.min(line.length, index + length + 24);
  return line.slice(start, end).replace(/\r$/, "");
}

function scanFile(rel) {
  const abs = path.join(ROOT, rel);
  const text = fs.readFileSync(abs, "utf8");
  const findings = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    MOJIBAKE_RE.lastIndex = 0;
    let match;
    while ((match = MOJIBAKE_RE.exec(line)) !== null) {
      findings.push({
        file: rel,
        line: i + 1,
        column: match.index + 1,
        match: match[0],
        snippet: snippetAround(line, match.index, match[0].length),
      });
    }
  }

  return findings;
}

const files = walk(ROOT);
const findings = [];

for (const rel of files) {
  findings.push(...scanFile(rel));
}

if (findings.length === 0) {
  console.log(
    `check-encoding: ok (${files.length} arquivos textuais, 0 mojibake).`,
  );
  process.exit(0);
}

const fileCount = new Set(findings.map((item) => item.file)).size;
console.error(
  `check-encoding: ${findings.length} ocorrência(s) em ${fileCount} arquivo(s):`,
);
console.error("");

for (const item of findings) {
  console.error(`${item.file}:${item.line}:${item.column}`);
  console.error(`  trecho: ${item.snippet}`);
  console.error(`  sequência: ${JSON.stringify(item.match)}`);
  console.error("");
}

process.exit(1);

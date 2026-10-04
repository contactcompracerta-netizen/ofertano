import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/*
 * Invariante forense da missão:
 * Price Monitor NUNCA pode criar Product.
 *
 * Falha se qualquer arquivo em src/services/priceMonitor referenciar
 * criação de produto (prisma.product.create, product.create, etc.).
 * PRICE_MONITOR_MODE continua REFRESH_ONLY por construção.
 */

const dir = path.join(process.cwd(), "src", "services", "priceMonitor");

function listarArquivos(diretorio: string): string[] {
  const entradas: string[] = [];

  for (const nome of readdirSync(diretorio)) {
    const completo = path.join(diretorio, nome);

    if (statSync(completo).isDirectory()) {
      entradas.push(...listarArquivos(completo));
    } else if (/\.(ts|mts|tsx|js)$/.test(nome) && !nome.includes(".test.")) {
      entradas.push(completo);
    }
  }

  return entradas;
}

const padraoProibido =
  /product\.create\s*\(|product\.createMany|product\.upsert|create\s*:\s*\{[^}]*name/i;

const violacoes: string[] = [];

for (const arquivo of listarArquivos(dir)) {
  const conteudo = readFileSync(arquivo, "utf8");

  if (padraoProibido.test(conteudo)) {
    violacoes.push(arquivo);
  }
}

if (violacoes.length > 0) {
  console.error("PRICE_MONITOR_PRODUCT_CREATION=BLOQUEADO");
  console.error(violacoes.join("\n"));
  process.exit(1);
}

console.log("PRICE_MONITOR_MODE=REFRESH_ONLY");
console.log("PRICE_MONITOR_PRODUCT_CREATION=0=PASS");

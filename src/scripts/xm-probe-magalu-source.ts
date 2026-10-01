/**
 * INSPEÇÃO DA FONTE MAGALU (§7 — blocker de dado, não de política).
 *
 * Antes de decidir QUALQUER coisa sobre identidade cross-market na Magalu é
 * preciso saber o que a fonte ENTREGA. Este script imprime, para produtos
 * reais, os campos estruturados e os atributos — sem nenhum julgamento.
 *
 * SOMENTE LEITURA.
 */
import { writeFileSync } from "node:fs";

import { buscarMagazineLuiza } from "@/services/discovery/magazineluiza";

const CONSULTAS = [
  "Samsung Smart TV 50\" MiniLED 4K M75H + Samsung Smart TV 32\" HD H5000F",
  "Smart TV Samsung UN50DU7700GXZD 50 4K Crystal",
  "Batedeira Planetária Electrolux EKM30",
  "Martelete Furadeira Impacto 800w Dewalt D25133k",
];

async function main(): Promise<void> {
  const relatorio: unknown[] = [];

  for (const query of CONSULTAS) {
    const r = await buscarMagazineLuiza({
      query,
      normalizedQuery: query.toLowerCase(),
      limit: 5,
      mode: "MULTILOJA",
      targetProductId: null,
    });
    console.log("");
    console.log(`### "${query}"  scanned=${r.scanned} candidatos=${r.candidates.length}`);
    for (const c of r.candidates.slice(0, 3)) {
      console.log(`  title : ${c.title.slice(0, 90)}`);
      console.log(`  brand : ${JSON.stringify(c.brand)}`);
      console.log(`  extId : ${c.externalId}`);
      console.log(`  attrs : ${JSON.stringify(c.attributes ?? null).slice(0, 700)}`);
      relatorio.push({ query, title: c.title, brand: c.brand, attributes: c.attributes ?? null });
    }
  }

  writeFileSync("/tmp/opencode/magalu_source_attrs.json", JSON.stringify(relatorio, null, 2), "utf8");
  console.log("");
  console.log("MAGALU_SOURCE_ATTRS_SAVED=/tmp/opencode/magalu_source_attrs.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

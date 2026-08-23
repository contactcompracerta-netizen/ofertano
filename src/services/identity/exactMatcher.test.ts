import assert from "node:assert/strict";

import { avaliarCompatibilidadeExataEntreImports } from "./exactMatcher";
import { pontuarEspecificidadeDaConsulta, criarConsultasGlobaisDeIdentidade } from "./queryMatcher";

function listing(
  title: string,
  brand: string | null = null,
  attributes: Record<string, string> = {},
) {
  return {
    title,
    brand,
    attributes,
  };
}

function mustBeExact(firstTitle: string, secondTitle: string, brand: string) {
  const result = avaliarCompatibilidadeExataEntreImports(
    listing(firstTitle, brand),
    listing(secondTitle, brand),
  );

  assert.equal(
    result.exact,
    true,
    `Expected EXACT:\n${firstTitle}\n${secondTitle}\n${result.reason}`,
  );
}

function mustBeDifferent(firstTitle: string, secondTitle: string, brand: string) {
  const result = avaliarCompatibilidadeExataEntreImports(
    listing(firstTitle, brand),
    listing(secondTitle, brand),
  );

  assert.equal(
    result.exact,
    false,
    `Expected DIFFERENT:\n${firstTitle}\n${secondTitle}\n${result.reason}`,
  );
}

mustBeExact(
  "Smartphone Samsung Galaxy A55 256GB Preto 5G",
  "Samsung Galaxy A55 5G 256 GB Dual Chip",
  "Samsung",
);

mustBeExact(
  "WAP W100 Bivolt",
  "Lavadora de Alta Pressao WAP W100",
  "WAP",
);

mustBeDifferent(
  "Samsung Galaxy A16 4G 128GB",
  "Samsung Galaxy A16 5G 128GB",
  "Samsung",
);

mustBeDifferent(
  "Motorola Moto G75 256GB",
  "Motorola Moto G77 256GB",
  "Motorola",
);

mustBeDifferent(
  "Samsung Galaxy A55 128GB",
  "Samsung Galaxy A55 256GB",
  "Samsung",
);

mustBeDifferent(
  "Aspirador de Po 127V Mondial",
  "Aspirador de Po 220V Mondial",
  "Mondial",
);

mustBeDifferent(
  "Smart TV Samsung 55 polegadas 4K",
  "Smart TV Samsung 65 polegadas 4K",
  "Samsung",
);

mustBeDifferent(
  "Samsung Galaxy A55 256GB",
  "Capa para Samsung Galaxy A55 256GB",
  "Samsung",
);

mustBeDifferent(
  "Fone JBL Tune 510BT",
  "Kit Fone JBL Tune 510BT + Capa",
  "JBL",
);

mustBeDifferent(
  "Motorola Edge 60 Fusion 256GB",
  "Motorola Edge 60 Pro 256GB",
  "Motorola",
);

mustBeExact(
  "Smartphone NovaTech Pulse NTX20‑41‑8C3 128GB 5G",
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G Dual Chip",
  "NovaTech",
);

mustBeDifferent(
  "Smartphone NovaTech Pulse NTX20-41-8C3 128GB 5G",
  "Smartphone NovaTech Pulse NTX20-41-9D1 128GB 5G",
  "NovaTech",
);

mustBeDifferent(
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD",
  "Notebook Gamer Acer Nitro V15 Intel Core i5 512GB SSD 16GB RAM NVIDIA RTX 4050 Linux ANV15-52-52X",
  "Acer",
);

mustBeExact(
  "Notebook Acer Nitro V15 ANV15‑52‑51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050",
  "Notebook Gamer Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB RTX 4050",
  "Acer",
);

const queryAcer =
  "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 RTX 4050 512SSD";

assert.ok(
  pontuarEspecificidadeDaConsulta(queryAcer, {
    title:
      "Notebook Acer Nitro V15 ANV15-52-51E4 Intel Core i5-13420H 16GB DDR5 NVIDIA GeForce RTX 4050 512SSD",
    brand: "Acer",
    attributes: {},
  }) >
    pontuarEspecificidadeDaConsulta(queryAcer, {
      title:
        "Notebook Gamer Acer Nitro V15 Intel Core i5 512GB SSD 16GB RAM NVIDIA RTX 4050 Linux ANV15-52-52X",
      brand: "Acer",
      attributes: {},
    }),
  "O SKU pedido na consulta deve pontuar mais que um submodelo vizinho da mesma linha.",
);

assert.ok(
  criarConsultasGlobaisDeIdentidade(queryAcer).some((consulta) =>
    /ANV15-52-51E4/i.test(consulta),
  ),
  "O plano global de busca deve usar o SKU especifico, nao so a linha V15.",
);

console.log("identity exact matcher: todos os casos globais passaram");

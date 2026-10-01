/**
 * CROSS-MARKET MATCHING FASE 2 — GERAÇÃO DE CONSULTAS DE CANDIDATO (§15).
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A §14 da missão separa dois conceitos que costumam ser confundidos:
 *
 *   SEARCH FAILURE  — o produto correto NUNCA entrou no top-N da busca.
 *   IDENTITY FAILURE — o produto correto entrou e o matcher REJEITOU.
 *
 * Matcher nenhum conserta search failure. Se a consulta é única e lexical
 * ("fone de ouvido bluetooth"), a busca devolve ruído e nenhuma correção de
 * identidade pode encontrar o item certo — porque ele não estava lá. Por
 * isso a estratégia de consulta é medida e versionada SEPARADAMENTE do
 * matcher, para que uma falha de busca nunca seja "compensada" afrouxando
 * política de identidade (§16).
 *
 * FAMÍLIAS DE CONSULTA (nesta ordem, que é a ordem de força):
 *
 *   1. GTIN / EAN     — identificador físico. Máxima especificidade; quando a
 *                       fonte aceita, é a consulta que não erra.
 *   2. brand + model   — marca e modelo estruturados, sem eixo de variante.
 *   3. brand + model + storage — resolve a capacidade quando o modelo é
 *                       família (ex.: "Galaxy A55" tem 128GB e 256GB).
 *   4. brand + model + size   — resolve a diagonal/cor quando o modelo é
 *                       família (ex.: "Smart TV Samsung" tem 50" e 65").
 *   5. distinctive tokens   — só os tokens que discriminam o produto dentro
 *                       da categoria.
 *
 * Nenhuma consulta é inventada: toda consulta é derivada de campo REAL do
 * seed (gtin, brand, model, eixo de variante, título). Se o seed não tem o
 * campo, a consulta correspondente NÃO é gerada — sem preenchimento de
 * espaço com texto livre.
 */

export type CandidateQueryStrategy =
  | "GTIN"
  | "BRAND_MODEL"
  | "BRAND_MODEL_STORAGE"
  | "BRAND_MODEL_SIZE"
  | "MODEL_ONLY"
  | "DISTINCTIVE";

export interface CandidateQueryV1 {
  strategy: CandidateQueryStrategy;
  query: string;
  /** Campos reais do seed que sustentam esta consulta. */
  derivedFrom: string[];
}

export interface SeedIdentityFieldsV1 {
  gtin: string | null;
  brand: string | null;
  /** Modelo estruturado extraído do título/campos, se houver. */
  model: string | null;
  storage: string | null;
  size: string | null;
  title: string;
}

/** Ruído de anúncio que nunca ajuda a distinguir produto. */
const STOPWORDS = new Set([
  "com",
  "sem",
  "para",
  "novo",
  "novos",
  "nova",
  "original",
  "lancamento",
  "frete",
  "gratis",
  "gratuito",
  "promocao",
  "oferta",
  "kit",
  "unidade",
  "unidades",
  "preto",
  "branco",
  "prata",
  "cinza",
  "azul",
  "vermelho",
  "verde",
  "rosa",
  "ouro",
  "ouro_rose",
  "product",
  "produto",
  "tipo",
  "qualidade",
  "primeira",
  "linha",
  "alta",
  "qualidade",
  "best",
  "top",
  "padrão",
  "padrao",
]);

/** Palavras cheias (>=4 letras) tendem a ser nome de modelo, não ruído. */
function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s.+-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * UNIDADES DE MEDIDA. Um código de modelo tem letras E dígitos; uma medida é
 * dígito+unidade. Confundir as duas foi o defeito real medido nesta fase: a
 * primeira versão do extrator devolvia `750W` para uma batedeira, `4K` para
 * uma TV, `1TB` para um SSD e `20CM` para um cesto — e a consulta derivada
 * (`Electrolux 750W`, `Samsung 4K`) devolvia só ruído. Isso é SEARCH
 * FAILURE (§16): nenhuma correção de identidade conserta uma busca que não
 * traz o produto certo.
 */
const UNIDADE_MEDIDA =
  /^(\d+(?:[.,]\d+)?)(kw|w|wh|whb|v|hz|khz|mhz|gb|tb|mb|kb|l|lts|ml|cl|cm|mm|m|pol|polegadas|polegada|inch|in|amp|a|kg|g|bar)$/i;

/** Resolução/qualidade de imagem: não é modelo. */
const QUALIDADE_IMAGEM =
  /^(2k|4k|8k|hd|fullhd|full-hd|uhd|qhd|hdr|hdready|sd|led|oled|qled|miniled|ips|va)$/i;

/**
 * Fator de forma / interface. Descreve o encaixe físico, não o modelo:
 * `M.2 2280` vale para dezenas de produtos diferentes. Entrar como "modelo"
 * faz a consulta virar `Pcyes M.2`, que devolve qualquer SSD do mundo.
 */
const FATOR_FORMA = /^(m\.?2|2\.?5|pcie|sata|nvme|u2|m\.?2\s?2280|2280|2242|2230)$/i;

/** Marca inválida: o campo `brand` do ML às vezes é lixo (ex.: "3D"). */
function marcaUtil(crud: string | null): string | null {
  const marca = crud?.trim() || null;
  if (!marca) return null;
  const tokens = tokenizar(marca);
  if (tokens.length === 0) return null;
  // "3D", "5", "1TB", "Ps4" não são marca de fabricante.
  if (
    tokens.every(
      (token) =>
        UNIDADE_MEDIDA.test(token) ||
        FATOR_FORMA.test(token) ||
        /^\d+$/.test(token) ||
        /^\d[a-z]$/i.test(token),
    )
  ) {
    return null;
  }
  // Marca real tem pelo menos 3 letras ("Sodimac", "Electrolux", "Philips").
  const letras = tokens.join("").replace(/[^a-z]/g, "").length;
  if (letras < 3) return null;
  return marca;
}

/**
 * Código de modelo:alfanumérico com pelo menos uma letra E um dígito, que
 * não seja medida nem palavra de qualidade. Cobre `a55`, `m75h`, `d25133k`,
 * `ekm30`, `af-106`, `book3`, `s23`, `pxm55`.
 */
function ehCodigoDeModelo(token: string): boolean {
  if (UNIDADE_MEDIDA.test(token)) return false;
  if (QUALIDADE_IMAGEM.test(token)) return false;
  if (FATOR_FORMA.test(token)) return false;
  if (STOPWORDS.has(token)) return false;
  if (!/\d/.test(token)) return false;
  if (!/[a-z]/.test(token)) return false;
  // Comprimento útil: 3..20 caracteres, para não pegar ruído longo.
  return token.length >= 3 && token.length <= 20;
}

export function extrairModelo(titulo: string, brand: string | null): string | null {
  const tokens = tokenizar(titulo);
  const marca = marcaUtil(brand);
  const marcaTokens = new Set(marca ? tokenizar(marca) : []);

  /*
   * Varre o título INTEIRO e coleta todos os códigos de modelo. Um anúncio
   * brasileiro frequentemente põe o modelo no fim ("Airfryer 6.5l Preto -
   * Af-106"), então só olhar a cabeça perde metade dos casos.
   */
  const candidatos: Array<{ token: string; posicao: number }> = [];

  for (let posicao = 0; posicao < tokens.length; posicao += 1) {
    const token = tokens[posicao];
    if (marcaTokens.has(token)) continue;
    if (!ehCodigoDeModelo(token)) continue;
    candidatos.push({ token, posicao });
  }

  if (candidatos.length === 0) {
    return null;
  }

  /*
   * Prefere o código mais LONGO: em títulos com mais de um código, o mais
   * específico é o do produto (`d25133kb2`), não o residual (`800w` já foi
   * descartado, mas `d25133k` vs `gc` é o caso típico). Empate resolve pela
   * posição mais próxima do fim do título, onde o vendedor grava o modelo.
   */
  candidatos.sort((a, b) => {
    if (b.token.length !== a.token.length) return b.token.length - a.token.length;
    return b.posicao - a.posicao;
  });

  return candidatos[0].token.toUpperCase();
}

/**
 * Núcleo textual do título: marca + modelo + eixo de variante, sem os nouns
 * de categoria ("batedeira", "smartphone", "fone") que só reduzem a base da
 * busca. É a consulta lexical mais específica que dá para montar sem inventar
 * dado.
 */
export function nucleoDoTitulo(
  titulo: string,
  brand: string | null,
  model: string | null,
): string | null {
  const marca = marcaUtil(brand);
  const partes = [marca, model].filter((parte): parte is string => Boolean(parte));
  const nucleo = partes.join(" ").trim();

  return nucleo.length >= 4 ? nucleo : null;
}

export function extrairStorage(titulo: string): string | null {
  const achado = /(\d{1,4})\s*(gb|tb|mb)\b/i.exec(titulo);
  if (!achado) return null;
  return `${achado[1]}${achado[2].toLowerCase()}`;
}

export function extrairSize(titulo: string): string | null {
  const polegadas = /(\d{2})\s*(?:\"|''|pol|polgadas?|inch)/i.exec(titulo);
  if (polegadas) return `${polegadas[1]}pol`;
  const roupa = /\b([pp]|m|g|gg|xg)\b(?=\s|$)/i.exec(titulo);
  if (roupa) return roupa[1].toUpperCase();
  return null;
}

/**
 * Nouns genéricos de categoria. Não distinguem produto dentro da categoria e
 * ainda pior:qvem anúncio de ACESSÓRIO. Manter "batedeira" na consulta é o
 * que faz a busca devolver peça de reposição em vez do aparelho.
 */
const NOUNS_CATEGORIA = new Set([
  "smartphone","celular","phone","notebook","laptop","tablet","televisor","tv",
  "monitor","fone","fones","ouvido","earphone","earbuds","headset","headphone",
  "batedeira","liquidificador","cafeteira","lavadora","microondas","micro-ondas",
  "airfryer","fritadeira","panela","ventilador","furadeira","parafusadeira",
  "martelete","esmerilhadeira","multimetro","chave","chaves","suporte","cadeira",
  "controle","gamepad","joystick","ssd","hd","hdd","memoria","ram","teclado",
  "mouse","cabo","carregador","fonte","adaptador","pelicula","capa","capinha",
  "estojo","bolsa","suporte","moldura","kit","original","premium","pro",
  "plus","max","ultra","smart","portatil","portátil","sem","fio","wireless",
  "bluetooth","conector","tomada","multifuncao","profissional","residencial",
]);

/**
 * Tokens distintivos: os que realmente discriminam o produto dentro da
 * categoria, removendo marca (já consultada), medidas, stopwords e nouns de
 * categoria. Sem isso a consulta vira eco do anúncio de acessório.
 */
export function tokensDistintivos(titulo: string, brand: string | null): string[] {
  const marca = new Set(marcaUtil(brand) ? tokenizar(marcaUtil(brand) as string) : []);

  const tokens = tokenizar(titulo).filter((token) => {
    if (marca.has(token)) return false;
    if (STOPWORDS.has(token)) return false;
    if (NOUNS_CATEGORIA.has(token)) return false;
    if (UNIDADE_MEDIDA.test(token)) return false;
    if (QUALIDADE_IMAGEM.test(token)) return false;
    if (token.length < 3) return false;
    return true;
  });

  return Array.from(new Set(tokens)).slice(0, 5);
}

/**
 * Gera as consultas candidatas para um seed, em ordem de especificidade.
 *
 * Função PURA: sem rede, sem banco. É por isso que a estratégia de busca é
 * testável e o recall@N é reproduzível.
 */
export function gerarConsultasDeCandidato(
  seed: SeedIdentityFieldsV1,
  maximo = 5,
): CandidateQueryV1[] {
  const consultas: CandidateQueryV1[] = [];
  const vistas = new Set<string>();

  const adicionar = (
    strategy: CandidateQueryStrategy,
    query: string,
    derivedFrom: string[],
  ) => {
    const limpa = query.replace(/\s+/g, " ").trim();
    if (limpa.length < 3) return;
    const chave = `${strategy}::${limpa.toLowerCase()}`;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    consultas.push({ strategy, query: limpa, derivedFrom });
  };

  // 1. GTIN / EAN — identificador físico.
  if (seed.gtin) {
    adicionar("GTIN", seed.gtin, ["gtin"]);
  }

  const brand = marcaUtil(seed.brand);
  const model = seed.model?.trim() || null;
  const baseModelo = [brand, model].filter(Boolean).join(" ");

  // 2. brand + model — o núcleo textual mais específico disponível.
  if (brand && model) {
    adicionar("BRAND_MODEL", baseModelo, ["brand", "model"]);
  }

  // 3. brand + model + storage
  if (brand && model && seed.storage) {
    adicionar(
      "BRAND_MODEL_STORAGE",
      `${baseModelo} ${seed.storage}`,
      ["brand", "model", "storage"],
    );
  }

  // 4. brand + model + size
  if (brand && model && seed.size) {
    adicionar("BRAND_MODEL_SIZE", `${baseModelo} ${seed.size}`, [
      "brand",
      "model",
      "size",
    ]);
  }

  // 5. model isolado — funciona mesmo quando o campo `brand` do ML é lixo
  //    (medido: "3D", "Fone de Ouvido"). O código de modelo sozinho é mais
  //    específico que a marca sozinha.
  if (model && (!brand || !model.toLowerCase().includes(brand.toLowerCase()))) {
    adicionar("MODEL_ONLY", model, ["model"]);
  }

  // 6. distinctive tokens (sem noun de categoria nem medida).
  const distintivos = tokensDistintivos(seed.title, brand);
  if (distintivos.length >= 2) {
    adicionar("DISTINCTIVE", distintivos.join(" "), ["title:distinctive"]);
  } else if (model) {
    adicionar("DISTINCTIVE", model, ["model"]);
  }

  return consultas.slice(0, maximo);
}

/** Deriva os campos de identidade a partir do seed cru. */
export function derivarCamposDeIdentidade(seed: {
  title: string;
  brand: string | null;
  gtin: string | null;
}): SeedIdentityFieldsV1 {
  const brand = marcaUtil(seed.brand);

  return {
    gtin: seed.gtin?.trim() || null,
    brand,
    model: extrairModelo(seed.title, brand),
    storage: extrairStorage(seed.title),
    size: extrairSize(seed.title),
    title: seed.title,
  };
}
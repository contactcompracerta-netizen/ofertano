export type ProductClassId =
  | "AUDIO_HEADPHONE"
  | "AUDIO_SPEAKER"
  | "AUDIO_MICROPHONE"
  | "SMARTPHONE"
  | "NOTEBOOK"
  | "TABLET"
  | "TV"
  | "MONITOR"
  | "CAMERA"
  | "DRILL"
  | "VACUUM"
  | "SCALE"
  | "LIGHTING"
  | "MIRROR"
  | "GAME"
  | "COOKWARE"
  | "CUTLERY"
  | "REMOTE"
  | "USB_DRIVE"
  | "FLASHLIGHT"
  | "MOUSE"
  | "KEYBOARD"
  | "WATCH"
  | "CONSOLE"
  | "BLENDER"
  | "FURNITURE"
  | "FURNITURE_PART"
  | "BOOK"
  | "APPAREL"
  | "TOY"
  | "AUTOMOTIVE_PULLEY_CRANKSHAFT"
  | "AUTOMOTIVE_PULLEY_ALTERNATOR"
  | "AUTOMOTIVE_CRANKSHAFT"
  | "AUTOMOTIVE_BELT"
  | "CASE_ACCESSORY"
  | "CONSUMABLE"
  | "UNKNOWN";

export type ClassCompatibility = "MATCH" | "MISSING" | "CONFLICT" | "UNKNOWN";

type ProductClassFamily = {
  id: Exclude<ProductClassId, "UNKNOWN">;
  phrases: string[];
  tokens: string[];
};

/*
 * Familias semanticas de produto. Role (MAIN/ACCESSORY) continua
 * separado: aqui classificamos o TIPO vendido, nao o papel.
 */
const PRODUCT_CLASS_FAMILIES: ProductClassFamily[] = [
  {
    id: "AUTOMOTIVE_PULLEY_CRANKSHAFT",
    phrases: [
      "polia virabrequim",
      "polia de virabrequim",
      "polia do virabrequim",
    ],
    tokens: [],
  },
  {
    id: "AUTOMOTIVE_PULLEY_ALTERNATOR",
    phrases: [
      "polia alternador",
      "polia do alternador",
      "polia de alternador",
    ],
    tokens: [],
  },
  {
    id: "AUTOMOTIVE_CRANKSHAFT",
    phrases: ["virabrequim completo"],
    tokens: ["virabrequim"],
  },
  {
    id: "AUTOMOTIVE_BELT",
    phrases: ["correia dentada", "correia de comando"],
    tokens: ["correia"],
  },
  {
    id: "BOOK",
    phrases: [],
    tokens: ["livro", "livros", "ebook"],
  },
  {
    id: "APPAREL",
    phrases: ["kit calcinha"],
    tokens: [
      "calcinha",
      "sutia",
      "lingerie",
      "camiseta",
      "camisa",
      "calca",
      "vestido",
      "blusa",
      "cueca",
    ],
  },
  {
    id: "TOY",
    phrases: ["brinquedo infantil"],
    tokens: ["brinquedo", "brinquedos"],
  },
  {
    id: "FURNITURE_PART",
    phrases: ["pe palito", "pe para movel", "pe de movel"],
    tokens: [],
  },
  {
    id: "AUDIO_HEADPHONE",
    phrases: [
      "fone de ouvido",
      "fones de ouvido",
      "fone sem fio",
      "fones sem fio",
      "in ear",
      "on ear",
      "over ear",
    ],
    tokens: [
      "fone",
      "fones",
      "headphone",
      "headphones",
      "headset",
      "earbuds",
      "earbud",
      "earphone",
      "earphones",
      "auricular",
      "auriculares",
    ],
  },
  {
    id: "AUDIO_SPEAKER",
    phrases: [
      "caixa de som",
      "caixa de audio",
      "caixas de som",
      "alto falante",
      "alto falantes",
      "sound box",
    ],
    tokens: [
      "speaker",
      "speakers",
      "altofalante",
      "soundbox",
      "soundbar",
    ],
  },
  {
    id: "AUDIO_MICROPHONE",
    phrases: ["microfone condensador"],
    tokens: ["microfone", "microphone"],
  },
  {
    id: "SMARTPHONE",
    phrases: [],
    tokens: ["smartphone", "celular", "telefone", "iphone"],
  },
  {
    id: "NOTEBOOK",
    phrases: [],
    tokens: ["notebook", "laptop", "ultrabook"],
  },
  {
    id: "TABLET",
    phrases: [],
    tokens: ["tablet", "ipad"],
  },
  {
    id: "TV",
    phrases: ["smart tv"],
    tokens: ["tv", "televisao", "televisor"],
  },
  {
    id: "MONITOR",
    phrases: [],
    tokens: ["monitor"],
  },
  {
    id: "CAMERA",
    phrases: ["camera digital", "camera fotografica"],
    tokens: ["camera", "webcam"],
  },
  {
    id: "DRILL",
    phrases: [],
    tokens: ["furadeira", "parafusadeira"],
  },
  {
    id: "VACUUM",
    phrases: ["aspirador de po"],
    tokens: ["aspirador"],
  },
  {
    id: "SCALE",
    phrases: ["balanca digital", "balanca corporal"],
    tokens: ["balanca", "scale"],
  },
  {
    id: "LIGHTING",
    phrases: [],
    tokens: ["lustre", "luminaria", "abajur", "pendente"],
  },
  {
    id: "MIRROR",
    phrases: [],
    tokens: ["espelho"],
  },
  {
    id: "GAME",
    phrases: ["jogo infantil", "jogo educativo", "board game"],
    tokens: ["jogo", "quebracabeca"],
  },
  {
    id: "COOKWARE",
    phrases: [],
    tokens: ["panela", "frigideira", "cacarola"],
  },
  {
    id: "CUTLERY",
    phrases: ["colher medidora", "colher de medida"],
    tokens: ["colher", "garfo"],
  },
  {
    id: "REMOTE",
    phrases: ["controle remoto"],
    tokens: ["controle"],
  },
  {
    id: "USB_DRIVE",
    phrases: ["pen drive", "pendrive", "flash drive"],
    tokens: ["pendrive", "flashdrive"],
  },
  {
    id: "FLASHLIGHT",
    phrases: [],
    tokens: ["lanterna"],
  },
  {
    id: "MOUSE",
    phrases: [],
    tokens: ["mouse"],
  },
  {
    id: "KEYBOARD",
    phrases: [],
    tokens: ["teclado", "keyboard"],
  },
  {
    id: "WATCH",
    phrases: [],
    tokens: ["relogio", "smartwatch"],
  },
  {
    id: "CONSOLE",
    phrases: [],
    tokens: ["console", "videogame"],
  },
  {
    id: "BLENDER",
    phrases: [],
    tokens: ["liquidificador"],
  },
  {
    id: "FURNITURE",
    phrases: [
      "mesa de cabeceira",
      "mesa de cabeceira",
      "criado mudo",
      "guarda roupa",
    ],
    tokens: [
      "mesa",
      "cabeceira",
      "criado",
      "comoda",
      "gaveta",
      "gavetas",
      "armario",
      "estante",
      "rack",
      "sofa",
      "cama",
      "moveis",
    ],
  },
  {
    id: "CASE_ACCESSORY",
    phrases: ["estojo de armazenamento", "bolsa de transporte"],
    tokens: ["estojo", "estojos"],
  },
  {
    id: "CONSUMABLE",
    phrases: ["saco de poeira", "sacos de poeira", "saco para poeira"],
    tokens: ["saco", "sacos", "refil", "refis", "filtro", "filtros"],
  },
];

function normalizeClassText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenBoundaryMatch(text: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(` ${text} `);
}

export function classificarClasseProduto(title: string): ProductClassId {
  const normalized = normalizeClassText(title);

  if (!normalized) {
    return "UNKNOWN";
  }

  let best: {
    id: ProductClassId;
    score: number;
    index: number;
  } | null = null;

  for (const family of PRODUCT_CLASS_FAMILIES) {
    let score = 0;
    let index = Number.POSITIVE_INFINITY;

    for (const phrase of family.phrases) {
      const position = normalized.indexOf(phrase);
      if (position >= 0) {
        score += phrase.split(" ").length * 3;
        index = Math.min(index, position);
      }
    }

    for (const token of family.tokens) {
      if (tokenBoundaryMatch(normalized, token)) {
        const position = normalized.indexOf(token);
        score += 1;
        index = Math.min(index, position);
      }
    }

    if (score === 0) {
      continue;
    }

    if (
      !best ||
      score > best.score ||
      (score === best.score && index < best.index)
    ) {
      best = {
        id: family.id,
        score,
        index,
      };
    }
  }

  return best?.id ?? "UNKNOWN";
}

export function classeEhProdutoPrincipal(
  id: ProductClassId,
): boolean {
  return (
    id !== "UNKNOWN" &&
    id !== "CASE_ACCESSORY" &&
    id !== "CONSUMABLE" &&
    id !== "REMOTE" &&
    id !== "FURNITURE_PART"
  );
}

export function compatibilidadeDeClasseProduto(
  queryClass: ProductClassId,
  candidateClass: ProductClassId,
): ClassCompatibility {
  if (queryClass === "UNKNOWN" && candidateClass === "UNKNOWN") {
    return "UNKNOWN";
  }

  if (queryClass === "UNKNOWN" || candidateClass === "UNKNOWN") {
    return "MISSING";
  }

  return queryClass === candidateClass ? "MATCH" : "CONFLICT";
}

export function familiasDeClasseProduto(): ProductClassFamily[] {
  return PRODUCT_CLASS_FAMILIES;
}

export function tokensDeClasseConhecidos(): Set<string> {
  const tokens = new Set<string>();

  for (const family of PRODUCT_CLASS_FAMILIES) {
    for (const token of family.tokens) {
      tokens.add(token);
    }

    for (const phrase of family.phrases) {
      for (const part of phrase.split(" ")) {
        if (part.length >= 2) {
          tokens.add(part);
        }
      }
    }
  }

  return tokens;
}

export function candidatoTemClasseEquivalente(
  queryToken: string,
  candidateTitle: string,
): boolean {
  const queryClass = classificarClasseProduto(queryToken);
  if (queryClass === "UNKNOWN") {
    return false;
  }

  return classificarClasseProduto(candidateTitle) === queryClass;
}

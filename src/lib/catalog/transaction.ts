/**
 * CATALOG_WAVE 1 - UNIDADE TRANSACIONAL (FASE K).
 *
 * Regra: falha na Offer depois da criação do Product => rollback total
 * da unidade. Nenhum Product órfão de Offer, nenhuma Offer órfã.
 *
 * O gateway é uma interface: a implementação Prisma real usará
 * prisma.$transaction; os testes usam a implementação em memória com
 * semântica de rollback idêntica (snapshot + restore).
 */

export interface ProductDraft {
  name: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  modelNumber?: string;
  store: string;
  price: number;
  currency: string;
  imageUrl?: string;
  description?: string;
  category?: string;
  affiliateUrl?: string;
  source: string;
  merchant: string;
  externalId: string;
}

export interface OfferDraft {
  productId: string;
  merchant: string;
  externalId: string;
  price: number;
  title: string;
  imageUrl?: string;
  sourceUrl?: string;
  affiliateUrl?: string;
}

export interface CatalogWriteOps {
  createProduct(draft: ProductDraft): Promise<{ id: string }>;
  createOffer(draft: OfferDraft): Promise<{ id: string }>;
  updateOffer(
    offerId: string,
    patch: { price: number; affiliateUrl?: string },
  ): Promise<void>;
}

export interface CatalogWriteGateway {
  /** Executa `fn` atomicamente: ou tudo persiste, ou nada persiste. */
  transaction<T>(fn: (ops: CatalogWriteOps) => Promise<T>): Promise<T>;
}

interface MemoryProduct extends ProductDraft {
  id: string;
}

interface MemoryOffer extends OfferDraft {
  id: string;
  active: boolean;
}

interface GatewaySnapshot {
  products: MemoryProduct[];
  offers: MemoryOffer[];
}

/**
 * Gateway em memória com rollback real de estado.
 * Também expõe as referências lidas pelo matcher/plan (fechando o
 * ciclo de idempotência: run1 escreve -> run2 enxerga -> UNCHANGED).
 */
export class InMemoryCatalogGateway implements CatalogWriteGateway {
  private products: MemoryProduct[] = [];
  private offers: MemoryOffer[] = [];
  private seq = 0;
  writeAttempts = 0;

  /** Injeção de falha: se definida, createOffer lança após criar. */
  failNextOfferCreation = false;

  async transaction<T>(fn: (ops: CatalogWriteOps) => Promise<T>): Promise<T> {
    const snapshot: GatewaySnapshot = {
      products: [...this.products],
      offers: [...this.offers],
    };
    try {
      return await fn(this.ops());
    } catch (err) {
      // Rollback total da unidade.
      this.products = snapshot.products;
      this.offers = snapshot.offers;
      throw err;
    }
  }

  private ops(): CatalogWriteOps {
    return {
      createProduct: async (draft) => {
        this.writeAttempts += 1;
        this.seq += 1;
        const row: MemoryProduct = { ...draft, id: `prod_${this.seq}` };
        this.products.push(row);
        return { id: row.id };
      },
      createOffer: async (draft) => {
        this.writeAttempts += 1;
        if (this.failNextOfferCreation) {
          this.failNextOfferCreation = false;
          throw new Error("OFFER_CREATE_FAILED");
        }
        this.seq += 1;
        const row: MemoryOffer = { ...draft, id: `off_${this.seq}`, active: true };
        this.offers.push(row);
        return { id: row.id };
      },
      updateOffer: async (offerId, patch) => {
        this.writeAttempts += 1;
        const target = this.offers.find((o) => o.id === offerId);
        if (!target) throw new Error("OFFER_NOT_FOUND");
        target.price = patch.price;
        if (patch.affiliateUrl !== undefined) {
          target.affiliateUrl = patch.affiliateUrl;
        }
      },
    };
  }

  snapshotProducts(): MemoryProduct[] {
    return [...this.products];
  }

  snapshotOffers(): MemoryOffer[] {
    return [...this.offers];
  }

  countProducts(): number {
    return this.products.length;
  }

  countOffers(): number {
    return this.offers.length;
  }
}

/** Gateway que recusa QUALQUER escrita (usado em DRY_RUN/DISABLED). */
export class NoWriteGateway implements CatalogWriteGateway {
  async transaction<T>(fn: (ops: CatalogWriteOps) => Promise<T>): Promise<T> {
    void fn;
    throw new Error("CATALOG_WRITE_BLOCKED: gateway sem escrita");
  }
}

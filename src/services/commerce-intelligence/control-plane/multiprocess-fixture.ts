/**
 * Shared local fixture for the 50AG.3 control-plane tests. Creates the minimal
 * products + EAN identifier the shadow identity graph needs to resolve the
 * synthetic canary input to EXACT identity, idempotently.
 */
import type { PrismaClient } from '@prisma/client';

export type Counts = { product: number; offer: number; history: number; raw: number; observation: number };

/** EAN of the synthetic fixture ("Synthetic JBL Tune 520BT"). */
export const fixtureEan = '4006381333931';

export async function ensureFixture(db: PrismaClient): Promise<void> {
  for (const [id, brand] of [['50ag3-primary', 'JBL'], ['50ag3-conflict', 'JBL']] as const) {
    if (!(await db.product.findUnique({ where: { id } }))) {
      await db.product.create({
        data: {
          id,
          name: 'Synthetic JBL Tune 520BT',
          image: 'https://shop.example/img',
          images: [],
          category: 'Synthetic',
          store: 'Synthetic',
          affiliateLink: 'https://shop.example/aff',
          price: 100,
          brand,
          active: false,
        },
      });
    }
  }
  if (!(await db.productIdentifier.findFirst({ where: { productId: '50ag3-primary', type: 'EAN' } }))) {
    await db.productIdentifier.create({
      data: {
        productId: '50ag3-primary',
        type: 'EAN',
        value: fixtureEan,
        normalizedValue: fixtureEan,
        source: 'local-fixture',
        confidence: 'EXACT',
      },
    });
  }
}
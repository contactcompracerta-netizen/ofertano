import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

type OfferRow = {
  marketplace: string;
  status: string;
  active: boolean;
  available: boolean;
  matchStatus: string;
  price: number;
};

function isUsableOffer(o: OfferRow): boolean {
  return (
    o.active &&
    o.matchStatus === "EXACT" &&
    o.available &&
    o.status !== "UNAVAILABLE" &&
    o.status !== "ERROR" &&
    Number.isFinite(o.price) &&
    o.price > 0
  );
}

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      offers: {
        select: {
          marketplace: true,
          status: true,
          active: true,
          available: true,
          matchStatus: true,
          price: true,
        },
      },
    },
  });

  const total = products.length;
  let publicMultistore = 0;
  let hiddenSingle = 0;
  let hiddenZero = 0;

  for (const p of products) {
    const usable = p.offers.filter(isUsableOffer);
    const distinct = new Set(usable.map((o) => o.marketplace)).size;

    if (distinct >= 2) {
      publicMultistore += 1;
    } else if (distinct === 1) {
      hiddenSingle += 1;
    } else {
      hiddenZero += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        TOTAL_PRODUCTS: total,
        PUBLIC_MULTISTORE_PRODUCTS: publicMultistore,
        HIDDEN_SINGLE_STORE_PRODUCTS: hiddenSingle,
        HIDDEN_ZERO_STORE_PRODUCTS: hiddenZero,
        DATABASE_DELETE_PERFORMED: false,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

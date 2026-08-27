import type {
  CanonicalProduct,
  ProductRole,
  RankTier,
  ScoredCandidate,
} from "./types";

export function assignRankTier(input: {
  status: "RELEVANT" | "REJECTED";
  role: ProductRole | null;
  strongIdentity: boolean;
  classOk: boolean;
  coreOk: boolean;
  discriminativeMissing: boolean;
}): RankTier {
  if (input.status !== "RELEVANT") {
    return 3;
  }

  const accessory = input.role === "ACCESSORY" || input.role === "REPLACEMENT_PART";
  if (accessory) {
    return 2;
  }

  if (
    input.role === "MAIN" &&
    input.strongIdentity &&
    input.classOk &&
    input.coreOk &&
    !input.discriminativeMissing
  ) {
    return 0;
  }

  if (input.role === "MAIN" && input.classOk && input.coreOk) {
    return input.discriminativeMissing ? 3 : 1;
  }

  return 3;
}

export function clusterRankTier(members: ScoredCandidate[]): RankTier {
  const tiers = members
    .filter((item) => item.status === "RELEVANT")
    .map((item) => item.rankTier);
  if (tiers.length === 0) {
    return 3;
  }

  return Math.min(...tiers) as RankTier;
}

export function rankCanonicalProducts(
  products: CanonicalProduct[],
): CanonicalProduct[] {
  return [...products].sort((first, second) => {
    if (first.rankTier !== second.rankTier) {
      return first.rankTier - second.rankTier;
    }

    if (first.confidence !== second.confidence) {
      return second.confidence - first.confidence;
    }

    if (first.marketplaces.length !== second.marketplaces.length) {
      return second.marketplaces.length - first.marketplaces.length;
    }

    return first.price - second.price;
  });
}

export type FavoriteRecord = {
  id: string;
  userId: string;
  productId: string;
  createdAt: Date;
};

export type FavoriteStore = {
  productExists(productId: string): Promise<boolean>;
  findByUserAndProduct(
    userId: string,
    productId: string
  ): Promise<FavoriteRecord | null>;
  listByUser(userId: string): Promise<FavoriteRecord[]>;
  create(userId: string, productId: string): Promise<FavoriteRecord>;
  deleteByUserAndProduct(
    userId: string,
    productId: string
  ): Promise<boolean>;
};

export type AddFavoriteResult = {
  favorite: FavoriteRecord;
  created: boolean;
};

export type RemoveFavoriteResult = {
  productId: string;
  removed: boolean;
};

export type MergeFavoritesResult = {
  productIds: string[];
  added: string[];
  alreadyPresent: string[];
  skippedInvalid: string[];
};

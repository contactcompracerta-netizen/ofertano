export const PRICE_ALERT_TYPES = {
  ANY_DROP: "ANY_DROP",
  TARGET_PRICE: "TARGET_PRICE",
} as const;

export type PriceAlertType =
  (typeof PRICE_ALERT_TYPES)[keyof typeof PRICE_ALERT_TYPES];

export type PriceAlertRecord = {
  id: string;
  userId: string;
  productId: string;
  type: PriceAlertType;
  targetPrice: number | null;
  referencePrice: number | null;
  active: boolean;
  armed: boolean;
  lastEvaluatedAt: Date | null;
  lastEvaluatedPrice: number | null;
  lastEvaluatedHadExact: boolean | null;
  lastTriggeredAt: Date | null;
  lastTriggeredPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PriceAlertEventRecord = {
  id: string;
  alertId: string;
  type: PriceAlertType;
  price: number;
  previousReferencePrice: number | null;
  targetPrice: number | null;
  createdAt: Date;
};

export type PriceAlertProductSummary = {
  id: string;
  name: string;
  image: string;
  price: number;
  slug: string | null;
};

export type PriceAlertWithDetails = PriceAlertRecord & {
  product: PriceAlertProductSummary | null;
  triggerCount: number;
  lastTrigger: {
    price: number;
    at: Date;
  } | null;
};

export type ExactOfferSnapshot = {
  productId: string;
  marketplace: string;
  matchStatus: string;
  active: boolean;
  available: boolean;
  status: string;
  price: number;
};

export type CreatePriceAlertInput = {
  productId: unknown;
  type: unknown;
  targetPrice?: unknown;
};

export type UpdatePriceAlertInput = {
  targetPrice?: unknown;
  active?: unknown;
  armed?: unknown;
};

export type CreatePriceAlertResult = {
  alert: PriceAlertWithDetails;
  created: boolean;
};

export type EvaluationSkipReason =
  | "NO_EXACT"
  | "NO_DROP"
  | "ABOVE_TARGET"
  | "ALREADY_TRIGGERED"
  | "INACTIVE";

export type AlertEvaluationResult = {
  alertId: string;
  productId: string;
  userId: string;
  type: PriceAlertType;
  hadExact: boolean;
  currentPrice: number | null;
  triggered: boolean;
  skippedReason?: EvaluationSkipReason;
};

export type EvaluateActivePriceAlertsResult = {
  evaluated: number;
  triggered: number;
  withoutExact: number;
  results: AlertEvaluationResult[];
};

export type PriceAlertEvaluationCommit = {
  lastEvaluatedAt: Date;
  lastEvaluatedPrice: number | null;
  lastEvaluatedHadExact: boolean;
  referencePrice?: number | null;
  armed?: boolean;
  lastTriggeredAt?: Date | null;
  lastTriggeredPrice?: number | null;
};

export type PriceAlertEventInput = {
  type: PriceAlertType;
  price: number;
  previousReferencePrice: number | null;
  targetPrice: number | null;
};

export type PriceAlertStore = {
  productExists(productId: string): Promise<boolean>;
  findProduct(
    productId: string
  ): Promise<PriceAlertProductSummary | null>;
  findAlertById(id: string): Promise<PriceAlertRecord | null>;
  findAlertByUserProductType(
    userId: string,
    productId: string,
    type: PriceAlertType
  ): Promise<PriceAlertRecord | null>;
  listAlertsByUser(userId: string): Promise<PriceAlertRecord[]>;
  listActiveAlerts(): Promise<PriceAlertRecord[]>;
  countEventsByAlert(alertId: string): Promise<number>;
  createAlert(input: {
    userId: string;
    productId: string;
    type: PriceAlertType;
    targetPrice: number | null;
    referencePrice: number | null;
  }): Promise<PriceAlertRecord>;
  updateAlert(
    id: string,
    data: Partial<
      Pick<
        PriceAlertRecord,
        | "targetPrice"
        | "referencePrice"
        | "active"
        | "armed"
        | "lastEvaluatedAt"
        | "lastEvaluatedPrice"
        | "lastEvaluatedHadExact"
        | "lastTriggeredAt"
        | "lastTriggeredPrice"
      >
    >
  ): Promise<PriceAlertRecord>;
  deleteAlertByUserAndId(userId: string, id: string): Promise<boolean>;
  listOffersByProductIds(
    productIds: string[]
  ): Promise<ExactOfferSnapshot[]>;
  commitEvaluation(
    alertId: string,
    data: PriceAlertEvaluationCommit,
    event?: PriceAlertEventInput
  ): Promise<PriceAlertRecord>;
};

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFFILIATE_PROVIDER_FLAG_NAMES,
  DEFAULT_AFFILIATE_PROVIDER_FLAGS,
  readAffiliateProviderFlags,
  resolveAffiliateLink,
  type AffiliateLinkInput,
  type AffiliateProvider,
  type AffiliateProviderId,
  type AffiliateProviderFlags,
} from "./linkEngine";
import { AFFILIATE_PROVIDER_REGISTRY } from "./providerRegistry";

const input: AffiliateLinkInput = {
  marketplace: "AMAZON",
  originalUrl: "https://www.amazon.com.br/dp/B0ABCDE123?color=black",
  offerId: "offer-1",
  productId: "product-1",
};

function provider(
  id: AffiliateProviderId,
  options: {
    supports?: boolean;
    configured?: boolean;
    build?: AffiliateProvider["buildLink"];
  } = {},
): AffiliateProvider {
  return {
    id,
    supports: () => options.supports ?? true,
    isConfigured: () => options.configured ?? true,
    buildLink:
      options.build ??
      (async (value) => ({
        url: `https://tracking.example/click?destination=${encodeURIComponent(value.originalUrl)}`,
      })),
  };
}

function enabled(id: AffiliateProviderId): AffiliateProviderFlags {
  return { ...DEFAULT_AFFILIATE_PROVIDER_FLAGS, [id]: true };
}

test("all future provider flags default off and accept only explicit true", () => {
  assert.deepEqual(DEFAULT_AFFILIATE_PROVIDER_FLAGS, {
    awin: false,
    shopee: false,
    amazon: false,
    aliexpress: false,
  });
  assert.deepEqual(readAffiliateProviderFlags({}), DEFAULT_AFFILIATE_PROVIDER_FLAGS);
  assert.equal(
    readAffiliateProviderFlags({ AFFILIATE_SHOPEE_ENABLED: "1" }).shopee,
    false,
  );
  assert.equal(
    readAffiliateProviderFlags({ AFFILIATE_SHOPEE_ENABLED: "true" }).shopee,
    true,
  );
  assert.equal(AFFILIATE_PROVIDER_FLAG_NAMES.awin, "AFFILIATE_AWIN_ENABLED");
});

test("future registry entries are unconfigured and make no external calls", async () => {
  const cases: Array<[string, string, AffiliateProviderId]> = [
    ["AMAZON", "", "amazon"],
    ["SHOPEE", "", "shopee"],
    ["ALIEXPRESS", "", "aliexpress"],
    ["KABUM", "AWIN", "awin"],
  ];

  for (const [marketplace, affiliateNetwork, id] of cases) {
    const registered = AFFILIATE_PROVIDER_REGISTRY.find(
      (candidate) => candidate.id === id,
    );
    assert.ok(registered);
    assert.equal(
      registered.supports({ ...input, marketplace, affiliateNetwork }),
      true,
    );
    assert.equal(registered.isConfigured(), false);
    const result = await resolveAffiliateLink(
      { ...input, marketplace, affiliateNetwork },
      { providers: [registered], flags: enabled(id) },
    );
    assert.equal(result.url, input.originalUrl);
    assert.equal(result.provider, "passthrough");
    assert.equal(result.monetized, false);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.reason, "PROVIDER_NOT_CONFIGURED");
  }
});

test("disabled and missing providers use the original offer URL", async () => {
  const disabledProvider = provider("amazon");
  let calls = 0;
  disabledProvider.buildLink = async () => {
    calls += 1;
    return { url: "https://tracking.example" };
  };

  const disabled = await resolveAffiliateLink(input, {
    providers: [disabledProvider],
  });
  const missing = await resolveAffiliateLink(input, { providers: [] });

  assert.equal(disabled.url, input.originalUrl);
  assert.equal(disabled.reason, "PROVIDER_DISABLED");
  assert.equal(missing.url, input.originalUrl);
  assert.equal(missing.reason, "NO_PROVIDER");
  assert.equal(calls, 0);
});

test("a provider exception fails safe without exposing exception details", async () => {
  const syntheticMarker = "synthetic-provider-marker";
  const result = await resolveAffiliateLink(input, {
    providers: [
      provider("amazon", {
        build: async () => {
          throw new Error(syntheticMarker);
        },
      }),
    ],
    flags: enabled("amazon"),
  });

  assert.equal(result.url, input.originalUrl);
  assert.equal(result.provider, "passthrough");
  assert.equal(result.reason, "PROVIDER_FAILED");
  assert.equal(JSON.stringify(result).includes(syntheticMarker), false);
});

test("provider support and configuration exceptions also fail safe", async () => {
  const throwsDuringSupport = provider("amazon", {
    supports: true,
  });
  throwsDuringSupport.supports = () => {
    throw new Error("private provider details");
  };
  const throwsDuringConfiguration = provider("amazon");
  throwsDuringConfiguration.isConfigured = () => {
    throw new Error("private configuration details");
  };

  for (const candidate of [throwsDuringSupport, throwsDuringConfiguration]) {
    const result = await resolveAffiliateLink(input, {
      providers: [candidate],
      flags: enabled("amazon"),
    });
    assert.equal(result.url, input.originalUrl);
    assert.equal(result.reason, "PROVIDER_FAILED");
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});

test("unsafe original and provider URLs are rejected", async () => {
  const unsafeOriginal = await resolveAffiliateLink({
    ...input,
    originalUrl: "javascript:alert(1)",
  }, {
    providers: [provider("amazon")],
    flags: enabled("amazon"),
  });
  const unsafeAffiliate = await resolveAffiliateLink(input, {
    providers: [provider("amazon", { build: async () => ({ url: "data:text/html,bad" }) })],
    flags: enabled("amazon"),
  });

  assert.equal(unsafeOriginal.url, null);
  assert.equal(unsafeOriginal.reason, "ORIGINAL_URL_INVALID");
  assert.equal(unsafeAffiliate.url, input.originalUrl);
  assert.equal(unsafeAffiliate.reason, "PROVIDER_URL_INVALID");
});

test("the matching provider is selected and unrelated providers are skipped", async () => {
  const calls: string[] = [];
  const unrelated = provider("shopee", {
    supports: false,
    build: async () => {
      calls.push("shopee");
      return { url: "https://shopee.example" };
    },
  });
  const amazon = provider("amazon", {
    build: async (value) => {
      calls.push("amazon");
      return {
        url: `https://tracking.example/click?destination=${encodeURIComponent(value.originalUrl)}`,
      };
    },
  });

  const result = await resolveAffiliateLink(input, {
    providers: [unrelated, amazon],
    flags: enabled("amazon"),
  });

  assert.equal(result.provider, "amazon");
  assert.equal(result.monetized, true);
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(calls, ["amazon"]);
});

test("reprocessing an unchanged original is idempotent and does not mutate it", async () => {
  const original = { ...input };
  const monetizer = provider("amazon");
  const options = { providers: [monetizer], flags: enabled("amazon") };

  const first = await resolveAffiliateLink(original, options);
  const second = await resolveAffiliateLink(original, options);
  const output = new URL(second.url!);

  assert.deepEqual(original, input);
  assert.equal(second.url, first.url);
  assert.equal(output.searchParams.getAll("destination").length, 1);
  assert.equal(decodeURIComponent(output.searchParams.get("destination")!), input.originalUrl);
});

test("invalid and secret-bearing provider failures return only curated results", async () => {
  const syntheticMarker = "do-not-return-this-marker";
  const result = await resolveAffiliateLink(input, {
    providers: [
      provider("amazon", {
        build: async () => {
          throw new Error(`request failed with ${syntheticMarker}`);
        },
      }),
    ],
    flags: enabled("amazon"),
  });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(syntheticMarker), false);
  assert.deepEqual(Object.keys(result).sort(), [
    "fallbackUsed",
    "provider",
    "reason",
    "url",
    "monetized",
  ].sort());
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return listTypeScriptFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

test("affiliate engine stays out of Client Components and has no network calls", () => {
  const clientFiles = ["src/app", "src/components"].flatMap((directory) =>
    listTypeScriptFiles(path.join(process.cwd(), directory)),
  );
  const clientImport = /services\/affiliates\/(?:linkEngine|providerRegistry)/;

  for (const file of clientFiles) {
    assert.doesNotMatch(readFileSync(file, "utf8"), clientImport, file);
  }

  for (const file of ["linkEngine.ts", "providerRegistry.ts"]) {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/i, file);
    assert.doesNotMatch(source, /https?:\/\//i, file);
  }
});
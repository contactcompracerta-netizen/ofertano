/**
 * Feed Ingestion Engine V1 - Normalization Core Tests.
 *
 * Pure function tests, deterministic, no network/DNS.
 * Preserva a diferenca entre ABSENT, VALID e INVALID.
 * Nao apagar silenciosamente input invalido.
 */
import {
  normalizePrice,
  normalizeCurrency,
  normalizeString,
  normalizeExternalId,
  normalizeGTIN,
  normalizeAttributes,
  normalizeExternalUrl,
  deduplicateUrls,
  type SafeUrlResult,
} from "./index";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL: " + message);
  }
}

// ===== normalizeString =====
console.log("=== normalizeString ===");

// undefined -> ABSENT
{
  const r = normalizeString(undefined);
  assert(r.status === 'ABSENT' && r.value === undefined, "undefined => ABSENT");
}

// null -> ABSENT
{
  const r = normalizeString(null);
  assert(r.status === 'ABSENT' && r.value === undefined, "null => ABSENT");
}

// "" -> ABSENT
{
  const r = normalizeString("");
  assert(r.status === 'ABSENT' && r.value === undefined, "'' => ABSENT");
}

// "   " -> ABSENT
{
  const r = normalizeString("   ");
  assert(r.status === 'ABSENT' && r.value === undefined, "'   ' => ABSENT");
}

// " abc " -> "abc"
{
  const r = normalizeString(" abc ");
  assert(r.status === 'VALID' && r.value === 'abc', "normalizeString ' abc ' => 'abc'");
}

// "hello" -> VALID
{
  const r = normalizeString("hello");
  assert(r.status === 'VALID' && r.value === 'hello', '"hello" => VALID');
}

// ===== normalizeExternalId =====
console.log("=== normalizeExternalId ===");

// Same rules as string
{
  const r = normalizeExternalId(undefined);
  assert(r.status === 'ABSENT', "externalId undefined => ABSENT");
}
{
  const r = normalizeExternalId("");
  assert(r.status === 'ABSENT', "externalId '' => ABSENT");
}
{
  const r = normalizeExternalId(" abc ");
  assert(r.status === 'VALID' && r.value === 'abc', "externalId ' abc ' => abc");
}

// ===== normalizeCurrency =====
console.log("=== normalizeCurrency ===");

// undefined -> ABSENT
{
  const r = normalizeCurrency(undefined);
  assert(r.status === 'ABSENT', "currency undefined => ABSENT");
}

// null -> ABSENT
{
  const r = normalizeCurrency(null);
  assert(r.status === 'ABSENT', "currency null => ABSENT");
}

// "brl" -> "BRL"
{
  const r = normalizeCurrency("brl");
  assert(r.status === 'VALID' && r.value === 'BRL', '"brl" => "BRL"');
}

// " BRL " -> "BRL"
{
  const r = normalizeCurrency(" BRL ");
  assert(r.status === 'VALID' && r.value === 'BRL', '" BRL " => "BRL"');
}

// "R$" -> INVALID_CURRENCY
{
  const r = normalizeCurrency("R$");
  assert(r.status === 'INVALID_CURRENCY', '"R$" => INVALID_CURRENCY');
}

// "R$ 100" -> INVALID_CURRENCY (tem numero junto, nao e so moeda)
{
  const r = normalizeCurrency("R$ 100");
  assert(r.status === 'INVALID_CURRENCY', '"R$ 100" => INVALID_CURRENCY');
}

// "USD" -> INVALID_CURRENCY (nao e BRL)
{
  const r = normalizeCurrency("USD");
  assert(r.status === 'INVALID_CURRENCY', '"USD" => INVALID_CURRENCY');
}

// "" -> INVALID_CURRENCY
{
  const r = normalizeCurrency("");
  assert(r.status === 'INVALID_CURRENCY', "'' => INVALID_CURRENCY");
}

// ===== normalizePrice =====
console.log("=== normalizePrice ===");

// undefined -> ABSENT
{
  const r = normalizePrice(undefined);
  assert(r.status === 'ABSENT', "price undefined => ABSENT");
}

// null -> ABSENT
{
  const r = normalizePrice(null);
  assert(r.status === 'ABSENT', "price null => ABSENT");
}

// "1299.90" -> { VALID, 1299.90 }
{
  const r = normalizePrice("1299.90");
  assert(r.status === 'VALID' && r.value === 1299.90, '"1299.90" => VALID 1299.90');
}

// "1299,90" -> { VALID, 1299.90 }
{
  const r = normalizePrice("1299,90");
  assert(r.status === 'VALID' && r.value === 1299.90, '"1299,90" => VALID 1299.90');
}

// "1.299,90" -> { VALID, 1299.90 } (BR format with dot as thousand separator)
{
  const r = normalizePrice("1.299,90");
  assert(r.status === 'VALID' && r.value === 1299.90, '"1.299,90" => VALID 1299.90');
}

// "R$ 1.299,90" -> { VALID, 1299.90 }
{
  const r = normalizePrice("R$ 1.299,90");
  assert(r.status === 'VALID' && r.value === 1299.90, '"R$ 1.299,90" => VALID 1299.90');
}

// "abc" -> INVALID
{
  const r = normalizePrice("abc");
  assert(r.status === 'INVALID', '"abc" => INVALID');
}

// "R$" -> INVALID
{
  const r = normalizePrice("R$");
  assert(r.status === 'INVALID', '"R$" => INVALID');
}

// NaN / Infinity rejection
{
  const r = normalizePrice(NaN);
  assert(r.status === 'INVALID', "NaN => INVALID");
}
{
  const r = normalizePrice(Infinity);
  assert(r.status === 'INVALID', "Infinity => INVALID");
}

// 0 -> INVALID
{
  const r = normalizePrice(0);
  assert(r.status === 'INVALID', "0 => INVALID");
}

// -10 -> INVALID
{
  const r = normalizePrice("-10");
  assert(r.status === 'INVALID', '-10 => INVALID');
}

// number input
{
  const r = normalizePrice(1299.90);
  assert(r.status === 'VALID' && r.value === 1299.90, "number 1299.90 => VALID");
}

// ===== normalizeGTIN =====
console.log("=== normalizeGTIN ===");

// undefined -> ABSENT
{
  const r = normalizeGTIN(undefined);
  assert(r.status === 'ABSENT', "GTIN undefined => ABSENT");
}

// null -> ABSENT
{
  const r = normalizeGTIN(null);
  assert(r.status === 'ABSENT', "GTIN null => ABSENT");
}

// "" -> ABSENT (explicit empty is absent, not invalid)
{
  const r = normalizeGTIN("");
  assert(r.status === 'ABSENT', "GTIN '' => ABSENT");
}

// "123456789" -> VALID (apenas normalizacao, nao validacao de formato)
{
  const r = normalizeGTIN("123456789");
  assert(r.status === 'VALID' && r.value === '123456789', '"123456789" => VALID');
}

// "abc" -> VALID (normalizacao so, validacao e do validator)
{
  const r = normalizeGTIN("abc");
  assert(r.status === 'VALID' && r.value === 'ABC', '"abc" => VALID ABC');
}

// ===== normalizeAttributes =====
console.log("=== normalizeAttributes ===");

// undefined -> ABSENT
{
  const r = normalizeAttributes(undefined);
  assert(r.status === 'ABSENT', "attributes undefined => ABSENT");
}

// null -> ABSENT
{
  const r = normalizeAttributes(null);
  assert(r.status === 'ABSENT', "attributes null => ABSENT");
}

// array -> INVALID
{
  const r = normalizeAttributes([{ foo: 'bar' }]);
  assert(r.status === 'INVALID', "array => INVALID");
}

// object -> VALID
{
  const r = normalizeAttributes({ foo: 'bar', baz: 123 });
  assert(r.status === 'VALID' && r.value.foo === 'bar', "object => VALID");
}

// ===== deduplicateUrls =====
console.log("=== deduplicateUrls ===");

// Deduplication test
{
  const results: SafeUrlResult[] = [
    { status: 'VALID', value: 'https://a.com/1' },
    { status: 'INVALID' },
    { status: 'VALID', value: 'https://a.com/1' }, // duplicate
    { status: 'VALID', value: 'https://b.com/2' },
    { status: 'ABSENT' },
  ];
  const deduped = deduplicateUrls(results);
  // Should have 3 valid unique + 1 absent
  const validCount = deduped.filter((r): r is { status: 'VALID'; value: string } => r.status === 'VALID').length;
  assert(validCount === 2, `dedupe should have 2 valid URLs (deduped), got ${validCount}`);
}

// ===== Integration tests =====
console.log("=== Integration ===");

// Price + Currency together
{
  const priceR = normalizePrice("1299,90");
  const curR = normalizeCurrency("brl");
  assert(priceR.status === 'VALID', "price '1299,90' => VALID");
  assert(curR.status === 'VALID' && curR.value === 'BRL', "currency 'brl' => BRL");
}

// URL safety integration
{
  const urlR = normalizeExternalUrl("https://example.com/product/1");
  assert(urlR.status === 'VALID', "https URL => VALID");
}

// ABSENT != INVALID distinction
{
  const absentPrice = normalizePrice(undefined);
  const invalidPrice = normalizePrice("abc");
  assert(absentPrice.status === 'ABSENT', "undefined price => ABSENT, not INVALID");
  assert(invalidPrice.status === 'INVALID', "abc price => INVALID, not ABSENT");
}

// Zero and negative are INVALID, not ABSENT
{
  const zeroR = normalizePrice(0);
  assert(zeroR.status === 'INVALID', "0 => INVALID");
}
{
  const negR = normalizePrice("-10");
  assert(negR.status === 'INVALID', "-10 => INVALID");
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
else console.log("NORMALIZATION_TESTS=PASS");
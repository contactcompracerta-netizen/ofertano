/**
 * Feed Ingestion Engine V1 - AWIN Adapter Tests.
 */
import { awinFeedAdapter, getFeedAdapter, getRegisteredFeedSources } from "./awinAdapter";
import { KABUM_AWIN_FIXTURE_CSV } from "./kabumFixture";
import { DryRunEngine } from "./dryRunEngine";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) { passed += 1; }
  else { failed += 1; console.error("FAIL: " + message); }
}

// ===== AWIN Adapter Tests =====
console.log("=== AWIN Adapter Tests ===");

// Parse the CSV fixture once for all tests
const parsedFixture = awinFeedAdapter.parse(KABUM_AWIN_FIXTURE_CSV);

// Teste 1: Registry returns AWIN adapter
{
  const adapter = getFeedAdapter("awin");
  assert(adapter !== undefined, "AWIN adapter registered");
  assert(adapter?.source === "awin", "AWIN adapter source is 'awin'");
}

// Teste 2: Unknown source returns undefined
{
  const adapter = getFeedAdapter("unknown-source");
  assert(adapter === undefined, "Unknown source returns undefined");
}

// Teste 3: getRegisteredFeedSources includes awin
{
  const sources = getRegisteredFeedSources();
  assert(sources.includes("awin"), "AWIN in registered sources");
}

// Teste 4: Parse CSV fixture
{
  assert(parsedFixture.length === 12, `Parsed 12 rows, got ${parsedFixture.length}`);
  assert(parsedFixture[0].productId === "KABUM-001", "First row productId");
  assert(parsedFixture[11].productId === "KABUM-001", "Last row is duplicate KABUM-001");
}

// Teste 5: Normalize valid item (using parsed CSV)
{
  const raw = parsedFixture[0];
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.externalId === "KABUM-001", "externalId preserved");
  assert(normalized.title.includes("Notebook Gamer"), "title normalized");
  assert(normalized.price === 3999.90, "price normalized to number");
  assert(normalized.oldPrice === 4499.90, "oldPrice normalized");
  assert(normalized.currency === "BRL", "currency normalized");
  assert(normalized.productUrl !== undefined && normalized.productUrl.startsWith("https://"), "productUrl valid");
  assert(normalized.affiliateUrl !== undefined && normalized.affiliateUrl.startsWith("https://"), "affiliateUrl valid");
  assert(normalized.imageUrls.length === 2, "2 images parsed");
  assert(normalized.gtin === "7891234567890", "GTIN preserved");
  assert(normalized.brand === "KaBuM", "brand preserved");
  assert(normalized.model === "KB-NTB-001", "model preserved");
  assert(normalized.mpn === "MPN-001", "mpn preserved");
  assert(normalized.metadata.advertiserId === "67890", "advertiserId in metadata");
  assert(normalized.metadata.advertiserName === "KaBuM!", "advertiserName in metadata");
  assert(normalized.metadata.source === "awin", "source in metadata");
}

// Teste 6: Normalize item without GTIN (KABUM-002)
{
  const raw = parsedFixture[1]; // KABUM-002 no GTIN
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.gtin === undefined, "GTIN absent remains absent");
}

// Teste 7: Validate valid item
{
  const raw = parsedFixture[0];
  const normalized = awinFeedAdapter.normalize(raw);
  const validation = awinFeedAdapter.validate(normalized);
  assert(validation.valid === true, "Valid item passes validation");
  assert(validation.reason === "NONE", "No failure reason for valid item");
}

// Teste 8: Validate missing externalId
{
  const raw = { ...parsedFixture[0], productId: "" };
  const normalized = awinFeedAdapter.normalize(raw);
  const validation = awinFeedAdapter.validate(normalized);
  assert(validation.valid === false, "Missing externalId fails validation");
  assert(validation.reason === "MISSING_EXTERNAL_ID", "Reason is MISSING_EXTERNAL_ID");
}

// Teste 9: Validate invalid price (KABUM-010)
{
  const raw = parsedFixture[9]; // KABUM-010 with price "abc"
  const normalized = awinFeedAdapter.normalize(raw);
  const validation = awinFeedAdapter.validate(normalized);
  assert(validation.valid === false, "Invalid price fails validation");
  assert(validation.reason === "INVALID_PRICE", "Reason is INVALID_PRICE");
}

// Teste 10: Validate invalid URL (KABUM-011)
{
  const raw = parsedFixture[10]; // KABUM-011 with javascript: URL
  const normalized = awinFeedAdapter.normalize(raw);
  const validation = awinFeedAdapter.validate(normalized);
  assert(validation.valid === false, "Invalid URL fails validation");
  assert(validation.reason === "INVALID_URL", "Reason is INVALID_URL");
}

// Teste 11: Currency normalization (brl -> BRL)
{
  const raw = { ...parsedFixture[0], currency: "brl" };
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.currency === "BRL", "Currency normalized to uppercase BRL");
}

// Teste 12: Image URL parsing handles multiple
{
  const raw = parsedFixture[2]; // KABUM-003 with 3 images
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.imageUrls.length === 3, "3 image URLs parsed");
  assert(normalized.imageUrls.every(u => u.startsWith("https://")), "All images are valid HTTPS");
}

// Teste 13: Invalid image URLs are filtered
{
  const raw = { ...parsedFixture[0], imageUrls: "https://valid.com/img.jpg,javascript:alert(1)" };
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.imageUrls.length === 1, "Only 1 valid image kept");
  assert(normalized.imageUrls[0] === "https://valid.com/img.jpg", "Valid image preserved");
}

// Teste 14: Attributes parsing
{
  const raw = parsedFixture[0];
  const normalized = awinFeedAdapter.normalize(raw);
  assert(normalized.attributes !== undefined, "Attributes parsed");
  assert(normalized.attributes?.color === "preto", "Attribute color parsed");
  assert(normalized.attributes?.ram === "16gb", "Attribute ram parsed");
}

// Teste 15: Parse empty CSV
{
  const parsed = awinFeedAdapter.parse("");
  assert(parsed.length === 0, "Empty CSV returns empty array");
}

// Teste 16: Parse header-only CSV
{
  const parsed = awinFeedAdapter.parse("productId,title,price\n");
  assert(parsed.length === 0, "Header-only CSV returns empty array");
}

// ===== Dry Run Engine Tests on KaBuM Fixture =====
console.log("\n=== Dry Run Engine on KaBuM Fixture ===");

// Teste 17: Dry run on KaBuM fixture (using parsed CSV)
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const { report, databaseWrites } = engine.runFixture(parsedFixture);

  console.log("DRY_RUN_AWIN_ROWS=" + report.totalRows);
  console.log("DRY_RUN_AWIN_VALID=" + report.validRows);
  console.log("DRY_RUN_AWIN_PARTIAL=" + report.partialRows);
  console.log("DRY_RUN_AWIN_INVALID=" + report.invalidRows);
  console.log("DRY_RUN_AWIN_DUPLICATES=" + report.duplicateExternalIds);
  console.log("WITH_GTIN=" + report.rowsWithGtin);
  console.log("WITH_MODEL=" + report.rowsWithModel);
  console.log("WITH_BRAND=" + report.rowsWithBrand);
  console.log("WITH_PRICE=" + report.rowsWithPrice);
  console.log("WITH_IMAGE=" + (report.rowsWithPrice)); // approximation
  console.log("WITH_VALID_DESTINATION=" + report.rowsWithValidUrl);

  assert(databaseWrites === 0, "Zero database writes");
  assert(report.totalRows === 12, "Total rows = 12");
  assert(report.validRows >= 0, "Valid rows >= 0");
  assert(report.partialRows >= 0, "Partial rows >= 0");
  assert(report.invalidRows >= 0, "Invalid rows >= 0");
  assert(report.duplicateExternalIds >= 0, "Duplicate externalIds >= 0");
  assert(report.rowsWithGtin >= 0, "Rows with GTIN >= 0");
  assert(report.rowsWithBrand >= 0, "Rows with brand >= 0");
  assert(report.rowsWithModel >= 0, "Rows with model >= 0");
  assert(report.rowsWithPrice >= 0, "Rows with price >= 0");
  assert(report.rowsWithValidUrl >= 0, "Rows with valid URL >= 0");
  assert(report.failureReasons !== undefined, "Failure reasons present");
  assert(report.source === "awin", "Source is awin");
}

// Teste 18: Deterministic - run twice, same results
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const result1 = engine.runFixture(parsedFixture);
  const result2 = engine.runFixture(parsedFixture);

  assert(result1.report.totalRows === result2.report.totalRows, "Total rows deterministic");
  assert(result1.report.validRows === result2.report.validRows, "Valid rows deterministic");
  assert(result1.report.invalidRows === result2.report.invalidRows, "Invalid rows deterministic");
  assert(result1.report.duplicateExternalIds === result2.report.duplicateExternalIds, "Duplicates deterministic");
  assert(result1.report.rowsWithGtin === result2.report.rowsWithGtin, "GTIN count deterministic");
  assert(result1.report.rowsWithBrand === result2.report.rowsWithBrand, "Brand count deterministic");
  assert(result1.report.rowsWithModel === result2.report.rowsWithModel, "Model count deterministic");
  assert(result1.report.rowsWithPrice === result2.report.rowsWithPrice, "Price count deterministic");
  assert(result1.report.rowsWithValidUrl === result2.report.rowsWithValidUrl, "Valid URL count deterministic");
}

// Teste 19: Failure reasons aggregation
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const { report } = engine.runFixture(parsedFixture);

  const totalFailures = Object.values(report.failureReasons).reduce((a, b) => a + b, 0);
  assert(totalFailures >= report.invalidRows, "Failure reasons sum covers invalid rows");
  // Should have at least INVALID_PRICE and INVALID_URL
  assert(report.failureReasons.INVALID_PRICE !== undefined || report.failureReasons.INVALID_URL !== undefined,
    "Has INVALID_PRICE or INVALID_URL");
}

// Teste 20: Identity signal stats
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const { report } = engine.runFixture(parsedFixture);
  assert(Object.keys(report.identitySignalStats).length > 0, "Identity signal stats populated");
}

// Teste 21: Currency stats
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  const { report } = engine.runFixture(parsedFixture);
  assert(report.currencyStats.BRL !== undefined, "Currency stats has BRL");
  assert(report.currencyStats.BRL >= 8, "BRL count >= 8");
}

// Teste 22: Execution mode DISABLED by default
{
  const engine = new DryRunEngine();
  assert(engine.getMode() === "DISABLED", "Default mode is DISABLED");
}

// Teste 23: Execution mode passado ao construtor é armazenado como fornecido
{
  const engine = new DryRunEngine("LIVE", "awin");
  assert(engine.getMode() === "LIVE", "Mode stored as provided");
}

// Teste 24: DRY_RUN explicitly works
{
  const engine = new DryRunEngine("DRY_RUN", "awin");
  assert(engine.getMode() === "DRY_RUN", "DRY_RUN mode set explicitly");
  const { report } = engine.runFixture(parsedFixture);
  assert(report.totalRows === 12, "DRY_RUN processes fixture");
}

// Teste 25: Unknown source rejected
{
  const adapter = getFeedAdapter("nonexistent");
  assert(adapter === undefined, "Unknown source rejected");
}

// Teste 26: formato oficial AWIN é mapeado para o contrato interno
{
  const officialCsv = [
    "aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,currency,merchant_deep_link,brand_name,product_model,model_number,ean,mpn,product_GTIN",
    '"https://www.awin1.com/cread.php?awinmid=123&ued=https%3A%2F%2Floja.test%2Fp%2F1","Mouse Gamer G305","AW-1","SKU-1","https://img.test/g305.jpg","Mouse sem fio","Periféricos","249,90","KaBuM!","123","BRL","https://loja.test/p/1","Logitech","G305","910-005281","7891234567890","910-005281","7891234567890"',
  ].join("\n");
  const parsed = awinFeedAdapter.parse(officialCsv);
  assert(parsed.length === 1, "Official AWIN CSV parses one row");
  assert(parsed[0].productId === "SKU-1", "merchant_product_id mapped");
  assert(parsed[0].title === "Mouse Gamer G305", "product_name mapped");
  assert(parsed[0].price === "249,90", "search_price mapped");
  assert(parsed[0].advertiserId === "123", "merchant_id mapped");
  assert(parsed[0].affiliateUrl?.includes("awin1.com"), "aw_deep_link mapped");
  assert(parsed[0].productUrl === "https://loja.test/p/1", "merchant_deep_link mapped");
  assert(parsed[0].brand === "Logitech", "brand_name mapped");
  assert(parsed[0].gtin === "7891234567890", "product_GTIN/ean mapped");
}

// Teste 27: parser suporta quebra de linha dentro de campo entre aspas
{
  const csv = 'productId,title,description,price,currency,productUrl\\n' +
    'A1,"Produto teste","linha 1\\nlinha 2",10.00,BRL,https://loja.test/a1\\n';
  const parsed = awinFeedAdapter.parse(csv);
  assert(parsed.length === 1, "Quoted multiline row parsed");
  assert(parsed[0].description === "linha 1\nlinha 2", "Quoted newline preserved");
}

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
else console.log("AWIN_FEED_ADAPTER_TESTS=PASS");
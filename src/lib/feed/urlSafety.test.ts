/**
 * Feed Ingestion Engine V1 - URL Safety Tests.
 *
 * Pure function tests:
 * - no network request
 * - no DNS lookup
 * - deterministic
 */
import { toSafeExternalUrl, isSafeExternalUrl, SafeUrlResult } from "./urlSafety";

function shouldBeAbsent(value: string | undefined | null, label: string) {
  const result = toSafeExternalUrl(value);
  if (result.status !== 'ABSENT') {
    throw new Error(`Expected "${label}" => ABSENT, got ${JSON.stringify(result)}`);
  }
}

function shouldBeValid(value: string, label: string) {
  const result = toSafeExternalUrl(value);
  if (result.status !== 'VALID') {
    throw new Error(`Expected "${label}" => VALID, got ${JSON.stringify(result)}`);
  }
}

function shouldBeInvalid(value: string, label: string) {
  const result = toSafeExternalUrl(value);
  if (result.status !== 'INVALID') {
    throw new Error(`Expected "${label}" => INVALID, got ${JSON.stringify(result)}`);
  }
}

/* --- ABSENT cases -------------------------------------------------------- */
shouldBeAbsent(undefined, "undefined");
shouldBeAbsent(null, "null");
shouldBeAbsent("", "empty string");
shouldBeAbsent("   ", "whitespace only");

/* --- VALID cases --------------------------------------------------------- */
shouldBeValid("https://example.com/product/1", "https URL with path");
shouldBeValid("http://example.com/product/1", "http URL with path");

/* --- URLs with query string and fragment => VALID ------------------------ */
shouldBeValid("https://example.com/a?x=1#section", "URL with query and fragment");

/* --- INVALID cases ------------------------------------------------------- */
shouldBeInvalid("javascript:alert(1)", "javascript scheme");
shouldBeInvalid("data:text/html,test", "data scheme");
shouldBeInvalid("file:///tmp/test", "file scheme");
shouldBeInvalid("ftp://example.com/file", "ftp scheme");
shouldBeInvalid("/produto/1", "relative path");
shouldBeInvalid("produto/1", "plain text without scheme");
shouldBeInvalid("https://user:pass@example.com/", "embedded credentials");

/* --- isSafeExternalUrl returns boolean ------------------------------------ */
if (isSafeExternalUrl(undefined) !== false) throw new Error("isSafeExternalUrl(undefined) should be false");
if (isSafeExternalUrl(null) !== false) throw new Error("isSafeExternalUrl(null) should be false");
if (isSafeExternalUrl("") !== false) throw new Error("isSafeExternalUrl('') should be false");
if (isSafeExternalUrl("https://example.com/product/1") !== true) throw new Error("isSafeExternalUrl(valid) should be true");
if (isSafeExternalUrl("javascript:alert(1)") !== false) throw new Error("isSafeExternalUrl(javascript) should be false");

/* --- SafeUrlResult type check -------------------------------------------- */
const undefinedResult: SafeUrlResult = toSafeExternalUrl(undefined);
const nullResult: SafeUrlResult = toSafeExternalUrl(null);
const emptyResult: SafeUrlResult = toSafeExternalUrl("");
const validResult: SafeUrlResult = toSafeExternalUrl("https://example.com/product/1");
const invalidResult: SafeUrlResult = toSafeExternalUrl("javascript:alert(1)");

if (undefinedResult.status !== 'ABSENT') throw new Error("undefined result should be ABSENT");
if (nullResult.status !== 'ABSENT') throw new Error("null result should be ABSENT");
if (emptyResult.status !== 'ABSENT') throw new Error("empty string result should be ABSENT");
if (validResult.status !== 'VALID') throw new Error("valid URL result should be VALID");
if (invalidResult.status !== 'INVALID') throw new Error("invalid URL result should be INVALID");
if (typeof validResult.value !== 'string') throw new Error("VALID result should have a value string");

console.log("URL_SAFETY_TESTS=PASS");
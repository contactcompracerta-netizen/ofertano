import assert from "node:assert/strict";

type ArrayContainingMatcher = {
  kind: "arrayContaining";
  expected: unknown[];
};

type StringMatchingMatcher = {
  kind: "stringMatching";
  expected: RegExp;
};

type Matcher = ArrayContainingMatcher | StringMatchingMatcher;

function isMatcher(value: unknown): value is Matcher {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ((value as { kind?: unknown }).kind === "arrayContaining" ||
      (value as { kind?: unknown }).kind === "stringMatching")
  );
}

function matches(actual: unknown, expected: unknown): boolean {
  if (isMatcher(expected)) {
    if (expected.kind === "stringMatching") {
      return typeof actual === "string" && expected.expected.test(actual);
    }

    return (
      Array.isArray(actual) &&
      expected.expected.every((expectedItem) =>
        actual.some((actualItem) => matches(actualItem, expectedItem)),
      )
    );
  }

  try {
    assert.deepStrictEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (isMatcher(expected)) {
    assert.ok(matches(actual, expected), "valor não corresponde ao matcher esperado");
    return;
  }

  assert.deepStrictEqual(actual, expected);
}

type Assertions = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
  toBeTruthy(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toHaveProperty(property: string): void;
  not: {
    toMatch(expected: RegExp | string): void;
  };
};

function createAssertions(actual: unknown): Assertions {
  const toRegExp = (expected: RegExp | string) =>
    expected instanceof RegExp ? expected : new RegExp(expected);

  return {
    toBe: (expected) => assert.strictEqual(actual, expected),
    toEqual: (expected) => assertEqual(actual, expected),
    toContain: (expected) => {
      const contains =
        typeof actual === "string"
          ? actual.includes(String(expected))
          : Array.isArray(actual)
            ? actual.some((item) => Object.is(item, expected))
            : false;
      assert.ok(contains, "valor não contém o item esperado");
    },
    toMatch: (expected) => assert.match(String(actual), toRegExp(expected)),
    toBeTruthy: () => assert.ok(actual),
    toBeGreaterThan: (expected) =>
      assert.ok(typeof actual === "number" && actual > expected),
    toBeGreaterThanOrEqual: (expected) =>
      assert.ok(typeof actual === "number" && actual >= expected),
    toBeLessThan: (expected) =>
      assert.ok(typeof actual === "number" && actual < expected),
    toBeLessThanOrEqual: (expected) =>
      assert.ok(typeof actual === "number" && actual <= expected),
    toHaveProperty: (property) =>
      assert.ok(
        typeof actual === "object" && actual !== null && property in actual,
        `valor não possui a propriedade ${property}`,
      ),
    not: {
      toMatch: (expected) => assert.doesNotMatch(String(actual), toRegExp(expected)),
    },
  };
}

type Expect = {
  (actual: unknown): Assertions;
  arrayContaining(expected: unknown[]): ArrayContainingMatcher;
  stringMatching(expected: RegExp): StringMatchingMatcher;
};

export const expect: Expect = Object.assign(createAssertions, {
  arrayContaining: (expected: unknown[]): ArrayContainingMatcher => ({
    kind: "arrayContaining",
    expected,
  }),
  stringMatching: (expected: RegExp): StringMatchingMatcher => ({
    kind: "stringMatching",
    expected,
  }),
});

export function describe(name: string, callback: () => void): void {
  console.log(name);
  callback();
}

export function it(name: string, callback: () => void): void {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

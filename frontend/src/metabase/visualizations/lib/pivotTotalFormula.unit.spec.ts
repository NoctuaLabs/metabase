import { evaluateTotalFormula, isValidTotalFormula } from "./pivotTotalFormula";

describe("evaluateTotalFormula", () => {
  const vars: Record<string, number | null> = {
    rev_d0: 1173.87,
    spend_d0: 462.13,
    zero: 0,
    missing: null,
  };
  const resolve = (name: string) => (name in vars ? vars[name] : null);

  it("computes a ratio formula from aggregated totals", () => {
    // rev_d0 / spend_d0 * 100 ≈ 254.0%  (raw ratio before percent formatting)
    const result = evaluateTotalFormula("rev_d0 / spend_d0 * 100", resolve);
    expect(result).toBeCloseTo((1173.87 / 462.13) * 100, 5);
  });

  it("respects operator precedence and parentheses", () => {
    expect(evaluateTotalFormula("2 + 3 * 4", resolve)).toBe(14);
    expect(evaluateTotalFormula("(2 + 3) * 4", resolve)).toBe(20);
  });

  it("handles unary minus", () => {
    expect(evaluateTotalFormula("-rev_d0 + rev_d0", resolve)).toBe(0);
    expect(evaluateTotalFormula("-(2 + 3)", resolve)).toBe(-5);
  });

  it("supports decimals", () => {
    expect(evaluateTotalFormula("0.5 * 10", resolve)).toBe(5);
  });

  it("supports bracketed column names with spaces", () => {
    const r = (name: string) => (name === "Cost Per Day" ? 50 : null);
    expect(evaluateTotalFormula("[Cost Per Day] * 2", r)).toBe(100);
  });

  it("returns null for division by zero", () => {
    expect(evaluateTotalFormula("rev_d0 / zero", resolve)).toBeNull();
  });

  it("returns null when a referenced column is missing/null", () => {
    expect(evaluateTotalFormula("rev_d0 / missing", resolve)).toBeNull();
    expect(evaluateTotalFormula("rev_d0 + unknown_col", resolve)).toBeNull();
  });

  it("returns null for an empty formula", () => {
    expect(evaluateTotalFormula("", resolve)).toBeNull();
    expect(evaluateTotalFormula("   ", resolve)).toBeNull();
  });

  it("throws on syntactically invalid formulas", () => {
    expect(() => evaluateTotalFormula("rev_d0 +", resolve)).toThrow();
    expect(() => evaluateTotalFormula("(rev_d0", resolve)).toThrow();
    expect(() => evaluateTotalFormula("rev_d0 # 2", resolve)).toThrow();
  });

  it("does not evaluate arbitrary code", () => {
    // Function calls / property access are not part of the grammar.
    expect(() => evaluateTotalFormula("constructor", () => null)).not.toThrow();
    expect(() => evaluateTotalFormula("a.b", resolve)).toThrow();
    expect(() => evaluateTotalFormula("foo()", resolve)).toThrow();
  });
});

describe("isValidTotalFormula", () => {
  it("accepts valid formulas and empty input", () => {
    expect(isValidTotalFormula("a / b * 100")).toBe(true);
    expect(isValidTotalFormula("")).toBe(true);
    expect(isValidTotalFormula("  ")).toBe(true);
    expect(isValidTotalFormula("(a + b) / 2")).toBe(true);
  });

  it("rejects malformed formulas", () => {
    expect(isValidTotalFormula("a +")).toBe(false);
    expect(isValidTotalFormula("a / / b")).toBe(false);
    expect(isValidTotalFormula(") a (")).toBe(false);
  });
});

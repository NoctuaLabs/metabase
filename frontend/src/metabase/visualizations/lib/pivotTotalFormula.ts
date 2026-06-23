// A tiny, safe arithmetic evaluator for pivot-table "custom total formulas".
//
// Users enter a formula such as `rev_d0 / spend_d0 * 100` in a measure's
// settings. When a total/subtotal row is rendered, the formula is evaluated
// against that row's already-aggregated column totals (each identifier resolves
// to the aggregated value of the column with that `name`). This lets a ratio
// column like `roas_d0` show `(sum rev_d0) / (sum spend_d0) * 100` for its
// totals instead of a plain sum/average of the per-cell ratios.
//
// The evaluator intentionally supports ONLY: numbers, identifiers (column
// names), the binary operators + - * /, unary minus, and parentheses. There is
// no access to globals, no function calls, and no `eval` — so a formula can
// never run arbitrary code.

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen" }
  | { type: "rparen" };

// Identifiers allow the characters used by Metabase column names: letters,
// digits, underscores. Names that contain other characters (spaces, dots, etc.)
// can be wrapped in [square brackets], matching the convention used elsewhere in
// Metabase custom expressions.
const IDENT_CHAR = /[A-Za-z0-9_]/;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }

    // Bracketed identifier: [Some Column Name]
    if (ch === "[") {
      const end = input.indexOf("]", i + 1);
      if (end === -1) {
        throw new Error("Unterminated [ in formula");
      }
      tokens.push({ type: "ident", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    // Number (integer or decimal).
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i + 1;
      while (
        j < input.length &&
        ((input[j] >= "0" && input[j] <= "9") || input[j] === ".")
      ) {
        j++;
      }
      const num = Number(input.slice(i, j));
      if (!isFinite(num)) {
        throw new Error(`Invalid number in formula: ${input.slice(i, j)}`);
      }
      tokens.push({ type: "number", value: num });
      i = j;
      continue;
    }

    // Bare identifier (column name).
    if (IDENT_CHAR.test(ch)) {
      let j = i + 1;
      while (j < input.length && IDENT_CHAR.test(input[j])) {
        j++;
      }
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character in formula: ${ch}`);
  }
  return tokens;
}

// Recursive-descent parser → evaluator over a token stream.
//   expr   := term (("+" | "-") term)*
//   term   := factor (("*" | "/") factor)*
//   factor := number | ident | "-" factor | "(" expr ")"
class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private resolve: (name: string) => number | null,
  ) {}

  parse(): number | null {
    const value = this.expr();
    if (this.pos !== this.tokens.length) {
      throw new Error("Unexpected trailing tokens in formula");
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private expr(): number | null {
    let left = this.term();
    let tok = this.peek();
    while (
      tok &&
      tok.type === "op" &&
      (tok.value === "+" || tok.value === "-")
    ) {
      this.pos++;
      const right = this.term();
      left = applyBinary(tok.value, left, right);
      tok = this.peek();
    }
    return left;
  }

  private term(): number | null {
    let left = this.factor();
    let tok = this.peek();
    while (
      tok &&
      tok.type === "op" &&
      (tok.value === "*" || tok.value === "/")
    ) {
      this.pos++;
      const right = this.factor();
      left = applyBinary(tok.value, left, right);
      tok = this.peek();
    }
    return left;
  }

  private factor(): number | null {
    const tok = this.peek();
    if (tok == null) {
      throw new Error("Unexpected end of formula");
    }
    if (tok.type === "op" && tok.value === "-") {
      this.pos++;
      const v = this.factor();
      return v == null ? null : -v;
    }
    if (tok.type === "op" && tok.value === "+") {
      this.pos++;
      return this.factor();
    }
    if (tok.type === "number") {
      this.pos++;
      return tok.value;
    }
    if (tok.type === "ident") {
      this.pos++;
      return this.resolve(tok.value);
    }
    if (tok.type === "lparen") {
      this.pos++;
      const v = this.expr();
      const next = this.peek();
      if (next == null || next.type !== "rparen") {
        throw new Error("Missing closing ) in formula");
      }
      this.pos++;
      return v;
    }
    throw new Error("Unexpected token in formula");
  }
}

// Null propagates (a missing input makes the whole result null), and division
// by zero yields null rather than Infinity so the total renders as blank.
function applyBinary(
  op: "+" | "-" | "*" | "/",
  left: number | null,
  right: number | null,
): number | null {
  if (left == null || right == null) {
    return null;
  }
  switch (op) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right === 0 ? null : left / right;
  }
}

/**
 * Evaluate a custom total formula. `resolve(name)` returns the aggregated total
 * for the column named `name`, or null if unavailable. Returns the numeric
 * result, or null when the formula is empty, references a missing column, or
 * divides by zero. Throws only on a syntactically invalid formula — callers
 * should treat a thrown error as "fall back to the default aggregation".
 */
export function evaluateTotalFormula(
  formula: string,
  resolve: (name: string) => number | null,
): number | null {
  const trimmed = (formula ?? "").trim();
  if (trimmed === "") {
    return null;
  }
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    return null;
  }
  const result = new Parser(tokens, resolve).parse();
  if (result == null || !isFinite(result)) {
    return null;
  }
  return result;
}

/** True if `formula` parses without error (used to validate user input). */
export function isValidTotalFormula(formula: string): boolean {
  const trimmed = (formula ?? "").trim();
  if (trimmed === "") {
    return true;
  }
  try {
    new Parser(tokenize(trimmed), () => 0).parse();
    return true;
  } catch {
    return false;
  }
}

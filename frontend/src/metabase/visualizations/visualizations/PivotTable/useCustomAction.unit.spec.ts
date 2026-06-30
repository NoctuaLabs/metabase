import { extractErrorMessage } from "./useCustomAction";

describe("extractErrorMessage", () => {
  it("returns the message from a structured api error ({ data: { message } })", () => {
    expect(
      extractErrorMessage({
        status: 400,
        data: { message: "Custom action service returned status 500: boom" },
      }),
    ).toBe("Custom action service returned status 500: boom");
  });

  it("returns a raw string error body", () => {
    expect(
      extractErrorMessage({ status: 500, data: "upstream stack trace" }),
    ).toBe("upstream stack trace");
  });

  it("falls back to a top-level message", () => {
    expect(extractErrorMessage({ message: "Network error" })).toBe(
      "Network error",
    );
  });

  it("uses the generic fallback when nothing usable is present", () => {
    expect(extractErrorMessage(null)).toBe("The custom action request failed.");
    expect(extractErrorMessage({ data: {} })).toBe(
      "The custom action request failed.",
    );
    expect(extractErrorMessage({ data: "   " })).toBe(
      "The custom action request failed.",
    );
  });
});

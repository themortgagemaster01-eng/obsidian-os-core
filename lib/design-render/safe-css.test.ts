import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isPlausibleCssColor,
  toSafeCssColor,
  toSafeFontFamilyStack,
  toCssFontWeight,
} from "@/lib/design-render/safe-css";

describe("safe-css", () => {
  test("isPlausibleCssColor accepts hex, rgb()/hsl(), and bare keywords", () => {
    assert.equal(isPlausibleCssColor("#fff"), true);
    assert.equal(isPlausibleCssColor("#1E3A5F"), true);
    assert.equal(isPlausibleCssColor("rgb(10, 20, 30)"), true);
    assert.equal(isPlausibleCssColor("hsl(200deg 50% 40%)"), true);
    assert.equal(isPlausibleCssColor("terracotta"), true);
  });

  test("isPlausibleCssColor rejects real Design Memory prose", () => {
    assert.equal(isPlausibleCssColor("Warm terracotta"), false);
    assert.equal(isPlausibleCssColor("Deep olive green"), false);
    assert.equal(isPlausibleCssColor("Warm cream / off-white"), false);
    assert.equal(isPlausibleCssColor(""), false);
  });

  test("toSafeCssColor falls back for unparseable input, passes through valid input", () => {
    assert.equal(toSafeCssColor("Muted gold", "#C9A227"), "#C9A227");
    assert.equal(toSafeCssColor("#C9A227", "#000"), "#C9A227");
    assert.equal(toSafeCssColor(undefined, "#000"), "#000");
    assert.equal(toSafeCssColor(null, "#000"), "#000");
  });

  test("toSafeFontFamilyStack always quotes the raw value and appends the fallback stack", () => {
    assert.equal(
      toSafeFontFamilyStack("Warm serif (e.g. a humanist serif)", "Georgia, serif"),
      '"Warm serif (e.g. a humanist serif)", Georgia, serif'
    );
    assert.equal(toSafeFontFamilyStack(undefined, "Georgia, serif"), "Georgia, serif");
  });

  test("toCssFontWeight maps every named weight to its numeric CSS value", () => {
    assert.equal(toCssFontWeight("regular"), 400);
    assert.equal(toCssFontWeight("medium"), 500);
    assert.equal(toCssFontWeight("semibold"), 600);
    assert.equal(toCssFontWeight("bold"), 700);
  });
});

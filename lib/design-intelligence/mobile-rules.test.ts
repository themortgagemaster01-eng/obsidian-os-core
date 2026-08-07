import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_TOUCH_TARGET_PX,
  MIN_TOUCH_TARGET_SPACING_PX,
  MOBILE_BODY_FONT_FLOOR_PX,
  MOBILE_READABILITY,
  validateTouchTarget,
  validateMobileTypeChoice,
} from "@/lib/design-intelligence/mobile-rules";

describe("mobile-rules: validateTouchTarget", () => {
  test("passes a target at exactly the minimum size and spacing", () => {
    const errors = validateTouchTarget({
      name: "cta",
      widthPx: MIN_TOUCH_TARGET_PX,
      heightPx: MIN_TOUCH_TARGET_PX,
      spacingPx: MIN_TOUCH_TARGET_SPACING_PX,
    });
    assert.deepEqual(errors, []);
  });

  test("flags a target smaller than the minimum in either dimension", () => {
    const tooNarrow = validateTouchTarget({ name: "cta", widthPx: 30, heightPx: 48, spacingPx: 12 });
    assert.equal(tooNarrow.length, 1);

    const tooShort = validateTouchTarget({ name: "cta", widthPx: 48, heightPx: 30, spacingPx: 12 });
    assert.equal(tooShort.length, 1);
  });

  test("flags insufficient spacing to the nearest neighbor", () => {
    const errors = validateTouchTarget({ name: "cta", widthPx: 48, heightPx: 48, spacingPx: 2 });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /spacing/);
  });

  test("can report both a size and a spacing violation at once", () => {
    const errors = validateTouchTarget({ name: "cta", widthPx: 20, heightPx: 20, spacingPx: 2 });
    assert.equal(errors.length, 2);
  });
});

describe("mobile-rules: validateMobileTypeChoice", () => {
  test("passes a choice within the mobile floor and readability band", () => {
    const errors = validateMobileTypeChoice({ bodyFontSizePx: 16, bodyLineLengthChars: 45 });
    assert.deepEqual(errors, []);
  });

  test("flags body font size below the mobile readable floor", () => {
    const errors = validateMobileTypeChoice({ bodyFontSizePx: 12, bodyLineLengthChars: 45 });
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(`${MOBILE_BODY_FONT_FLOOR_PX}px`));
  });

  test("flags line length outside the mobile-scale band, both under and over", () => {
    const tooShort = validateMobileTypeChoice({ bodyFontSizePx: 16, bodyLineLengthChars: 10 });
    assert.equal(tooShort.length, 1);

    const tooLong = validateMobileTypeChoice({ bodyFontSizePx: 16, bodyLineLengthChars: 90 });
    assert.equal(tooLong.length, 1);
  });

  test("readability band constants are internally consistent", () => {
    assert.ok(MOBILE_READABILITY.bodyLineLengthCharsMin < MOBILE_READABILITY.bodyLineLengthCharsMax);
  });
});

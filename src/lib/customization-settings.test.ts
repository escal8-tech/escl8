import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCustomizationSettings
} from "@/lib/customization-settings";

test("normalizeCustomizationSettings handles colors", () => {
  const raw = {
    customization: {
      primaryColor: "00ff00",
      secondaryColor: "#ff0000"
    }
  };
  const normalized = normalizeCustomizationSettings(raw);
  assert.equal(normalized.primaryColor, "#00FF00");
  assert.equal(normalized.secondaryColor, "#FF0000");
});

test("normalizeCustomizationSettings defaults missing fields", () => {
  const normalized = normalizeCustomizationSettings({});
  assert.equal(normalized.primaryColor, "#0E1B40");
  assert.equal(normalized.businessName, "");
});

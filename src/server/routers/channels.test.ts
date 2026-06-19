import test from "node:test";
import assert from "node:assert/strict";
import { channelsRouter } from "./channels";

test("channelsRouter has expected procedures", () => {
  assert.ok(channelsRouter.listChannels);
  assert.ok(channelsRouter.updateChannel);
});

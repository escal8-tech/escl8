import test from "node:test";
import assert from "node:assert/strict";

import { formatFieldValue, formatItemsCell } from "@/app/portal/tickets/lib/ticketPageUtils";

test("ticket item formatting excludes delivery fee rows", () => {
  const fields = {
    line_items: [
      { item: "Bulb Camara", quantity: 3, unit_price: "1,990", line_total: "5,970" },
      { item: "Delivery (free)", quantity: 1, unit_price: "0", line_total: "0" },
    ],
  };

  assert.equal(formatItemsCell(fields), "Bulb Camara x 3");
  assert.equal(formatFieldValue(fields.line_items, "line_items", fields), "Bulb Camara (qty 3 x 1,990 = 5,970)");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichInboundInteractive,
  humanizeReplyToken,
  parseInboundInteractive,
  parseOutboundInteractive,
} from "./interactiveMessage";

test("humanizeReplyToken converts order2 reply ids into staff-friendly labels", () => {
  assert.equal(humanizeReplyToken("o2:delivery"), "Delivery");
  assert.equal(humanizeReplyToken("o2:item:4"), "Selected item #4");
});

test("parseOutboundInteractive reads button payloads from meta", () => {
  const parsed = parseOutboundInteractive({
    id: "1",
    direction: "outbound",
    messageType: "interactive",
    textBody: "Choose delivery or pickup",
    createdAt: new Date(),
    meta: {
      interactive: {
        type: "button",
        body: { text: "Choose delivery or pickup" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "o2:delivery", title: "Delivery" } },
            { type: "reply", reply: { id: "o2:pickup", title: "Pickup" } },
          ],
        },
      },
    },
  });

  assert.equal(parsed?.kind, "button");
  assert.equal(parsed?.buttons.length, 2);
  assert.equal(parsed?.buttons[1]?.title, "Pickup");
});

test("parseInboundInteractive prefers saved reply titles over raw ids", () => {
  const parsed = parseInboundInteractive({
    id: "2",
    direction: "inbound",
    messageType: "interactive",
    textBody: "o2:delivery",
    createdAt: new Date(),
    meta: {
      interactive: {
        reply_id: "o2:delivery",
        reply_title: "Delivery",
        reply_kind: "button_reply",
      },
    },
  });

  assert.equal(parsed?.replyTitle, "Delivery");
});

test("enrichInboundInteractive links a customer tap back to the prior bot prompt", () => {
  const messages = [
    {
      id: "a",
      direction: "outbound",
      messageType: "interactive",
      textBody: "Choose delivery or pickup",
      createdAt: new Date(),
      meta: {
        interactive: {
          type: "button",
          body: { text: "Choose delivery or pickup" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "o2:delivery", title: "Delivery" } },
              { type: "reply", reply: { id: "o2:pickup", title: "Pickup" } },
            ],
          },
        },
      },
    },
    {
      id: "b",
      direction: "inbound",
      messageType: "interactive",
      textBody: "o2:delivery",
      createdAt: new Date(),
      meta: {
        interactive: {
          reply_id: "o2:delivery",
          reply_title: "Delivery",
          reply_kind: "button_reply",
        },
      },
    },
  ];

  const enriched = enrichInboundInteractive(messages[1]!, messages, 1);
  assert.equal(enriched?.replyTitle, "Delivery");
  assert.equal(enriched?.promptText, "Choose delivery or pickup");
});
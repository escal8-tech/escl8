import test from "node:test";
import assert from "node:assert/strict";

import { readMediaInfo } from "./mediaInfo";

test("readMediaInfo reads nested inbound media metadata", () => {
  const info = readMediaInfo({
    messageType: "image",
    textBody: "[image]",
    meta: {
      message_media: {
        mediaType: "image",
        mediaUrl: "https://blob.example.com/image.jpg",
        caption: "Do u have this item for sale",
        fileName: "image.jpg",
      },
    },
  });

  assert.equal(info.messageType, "image");
  assert.equal(info.imageUrl, "https://blob.example.com/image.jpg");
  assert.equal(info.caption, "Do u have this item for sale");
  assert.equal(info.filename, "image.jpg");
});

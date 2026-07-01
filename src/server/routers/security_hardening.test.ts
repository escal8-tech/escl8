import test from "node:test";
import assert from "node:assert/strict";
import { bookingsRouter } from "./bookings";
import { inventoryRouter } from "./inventory";
import { ragRouter } from "./rag";
import { userRouter } from "./user";

test("Security Hardening: Bookings Router isolation", () => {
  assert.ok(bookingsRouter.list);
  assert.ok(bookingsRouter.create);
  // Verify create input doesn't allow businessId or userId anymore
  const createSchema = (bookingsRouter.create as any)._def.inputs[0];
  if (createSchema) {
    const shape = createSchema.shape;
    assert.strictEqual(shape.businessId, undefined, "businessId should not be in create input");
    assert.strictEqual(shape.userId, undefined, "userId should not be in create input");
  }
});

test("Security Hardening: Inventory Router isolation", () => {
  assert.ok(inventoryRouter.listItems);
  assert.ok(inventoryRouter.listOffers);
  assert.ok(inventoryRouter.getColumnMapping);
  assert.ok(inventoryRouter.saveColumnMapping);
  assert.ok(inventoryRouter.updateItemQuantity);

  // updateItemQuantity should not have agentId in input
  const updateSchema = (inventoryRouter.updateItemQuantity as any)._def.inputs[0];
  if (updateSchema) {
    assert.strictEqual(updateSchema.shape.agentId, undefined, "agentId should be removed from updateItemQuantity input");
  }
});

test("Security Hardening: RAG Router reduction", () => {
  const procedures = [
    ragRouter.enqueueRetrain,
    ragRouter.regenerateInstructions,
    ragRouter.getInstructionsStatus,
    ragRouter.retrieve,
    ragRouter.getContext
  ];

  for (const proc of procedures) {
    const input = (proc as any)._def.inputs[0];
    if (input && input.shape) {
      assert.strictEqual(input.shape.email, undefined, "email should be removed from RAG router inputs");
    }
  }
});

test("Security Hardening: User Router reduction", () => {
  const procedures = [
    userRouter.ensure,
    userRouter.getMe,
    userRouter.getAccessStatus,
    userRouter.upsert
  ];

  for (const proc of procedures) {
    const input = (proc as any)._def.inputs[0];
    if (input && input.shape) {
      assert.strictEqual(input.shape.email, undefined, "email should be removed from user router inputs");
    }
  }
});

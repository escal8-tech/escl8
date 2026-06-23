import test from "node:test";
import assert from "node:assert/strict";
import { businessRouter } from "./business";

test("businessRouter has expected procedures", () => {
  assert.ok(businessRouter.listPhoneNumbers);
  assert.ok(businessRouter.setWhatsappIdentityAutoReplyPaused);
  assert.ok(businessRouter.setWhatsappIdentityAiDisabled);
  assert.ok(businessRouter.getMine);
  assert.ok(businessRouter.updateMessageUsageTier);
  assert.ok(businessRouter.updateBookingConfig);
  assert.ok(businessRouter.updateTimezone);
  assert.ok(businessRouter.updateOrderSettings);
  assert.ok(businessRouter.updateCustomizationSettings);
  assert.ok(businessRouter.ensureWebsiteWidget);
  assert.ok(businessRouter.disconnectGmailConnection);
  assert.ok(businessRouter.getSetupStatus);
  assert.ok(businessRouter.completeOnboardingSetup);
  assert.ok(businessRouter.getSubscription);
});

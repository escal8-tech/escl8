import "server-only";
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { executeStatement, withTransaction } from "@/lib/db";
import { amountForSenangPay, senangPayCheckoutUrl, type SenangPayCallbackPayload } from "@/lib/senangpay";
import {
  senangPayRecurringCheckoutUrl,
  type SenangPayRecurringCallbackPayload,
  type SenangPayRecurringStandardCallbackPayload,
} from "@/lib/senangpay-recurring";

type CheckoutInput = {
  suiteTenantId: string;
  planCode: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

type RecurringCheckoutInput = {
  suiteTenantId: string;
  planCode: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

type SubscriptionForPayment = {
  id: string;
  suite_tenant_id: string;
  plan_code: string;
  current_period_due_at: string | null;
  starts_at: string | null;
  next_due_at: string | null;
  price_amount: number;
  currency: string;
  billing_period_months: number;
  display_name: string;
  grant_kind: string;
  metadata: Record<string, unknown> | null;
};

function addMonths(anchor: Date, months: number) {
  const next = new Date(anchor);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function normalizeContact(value: string | null | undefined, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function safeOrderId(id: string) {
  const uuidPrefix = randomUUID().slice(0, 8);
  const sanitized = id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 48);
  return `${uuidPrefix}-${sanitized}`.slice(0, 60);
}

async function ensureSubscriptionForPlan(client: PoolClient, input: CheckoutInput): Promise<SubscriptionForPayment> {
  const planRows = await client.query<{
    code: string;
    display_name: string;
    price_amount: number;
    currency: string;
    billing_period_months: number;
    grant_kind: string;
    metadata: Record<string, unknown> | null;
  }>(
    `
      select code, display_name, price_amount, currency, billing_period_months, grant_kind, metadata
      from suite_subscription_plans
      where code = $1 and is_active = true
      limit 1
    `,
    [input.planCode],
  );
  const plan = planRows.rows[0];
  if (!plan) throw new Error("Plan code was not found.");
  if (String(plan.grant_kind || "standard") !== "standard") {
    throw new Error("Demo and partner plans are not payable through SenangPay.");
  }
  if (Boolean(plan.metadata?.contactSalesOnly) || Number(plan.price_amount || 0) <= 0) {
    throw new Error("This plan is contact-only and cannot be paid through checkout.");
  }

  const existingRows = await client.query<{ id: string }>(
    `
      select id
      from suite_tenant_subscriptions
      where suite_tenant_id = $1
      order by updated_at desc
      limit 1
    `,
    [input.suiteTenantId],
  );

  const now = new Date();
  const dueAt = addMonths(now, Number(plan.billing_period_months || 1) || 1);
  let subscriptionId = existingRows.rows[0]?.id ?? null;

  if (subscriptionId) {
    await client.query(
      `
        update suite_tenant_subscriptions
        set
          plan_code = $2,
          status = case when status = 'active' and plan_code = $2 then status else 'pending_setup' end,
          starts_at = coalesce(starts_at, $3::timestamptz),
          current_period_start = coalesce(current_period_start, $3::timestamptz),
          current_period_due_at = $4::timestamptz,
          next_due_at = $4::timestamptz,
          cancelled_at = case when $2 = 'cancelled' then now() else null end,
          metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb,
          updated_at = now()
        where id = $1
      `,
      [
        subscriptionId,
        input.planCode,
        now.toISOString(),
        dueAt.toISOString(),
        JSON.stringify({ lastCheckoutSource: "senangpay" }),
      ],
    );
  } else {
    const created = await client.query<{ id: string }>(
      `
        insert into suite_tenant_subscriptions (
          suite_tenant_id,
          plan_code,
          status,
          starts_at,
          current_period_start,
          current_period_due_at,
          next_due_at,
          metadata
        )
        values ($1, $2, 'pending_setup', $3::timestamptz, $3::timestamptz, $4::timestamptz, $4::timestamptz, $5::jsonb)
      `,
      [
        input.suiteTenantId,
        input.planCode,
        now.toISOString(),
        dueAt.toISOString(),
        JSON.stringify({ source: "senangpay-checkout" }),
      ],
    );
    subscriptionId = created.rows[0]?.id ?? null;
  }

  if (!subscriptionId) throw new Error("Could not create subscription.");

  const subscriptionRows = await client.query<SubscriptionForPayment>(
    `
      select
        sub.id,
        sub.suite_tenant_id,
        sub.plan_code,
        sub.current_period_due_at::text,
        sub.starts_at::text,
        sub.next_due_at::text,
        plan.price_amount,
        plan.currency,
        plan.billing_period_months,
        plan.display_name,
        plan.grant_kind,
        plan.metadata
      from suite_tenant_subscriptions sub
      inner join suite_subscription_plans plan on plan.code = sub.plan_code
      where sub.id = $1
      limit 1
    `,
    [subscriptionId],
  );

  const subscription = subscriptionRows.rows[0];
  if (!subscription) throw new Error("Could not load subscription.");
  return subscription;
}

export async function createSenangPayCheckout(input: CheckoutInput) {
  return withTransaction("control", async (client) => {
    const subscription = await ensureSubscriptionForPlan(client, input);
    const amount = Number(subscription.price_amount || 0);
    const eventRows = await client.query<{ id: string }>(
      `
        insert into suite_tenant_payment_events (
          subscription_id,
          suite_tenant_id,
          status,
          amount,
          currency,
          due_at,
          reference,
          metadata
        )
        values ($1, $2, 'pending', $3, $4, $5::timestamptz, $6, $7::jsonb)
        returning id
      `,
      [
        subscription.id,
        subscription.suite_tenant_id,
        amount,
        subscription.currency,
        subscription.current_period_due_at ?? subscription.next_due_at ?? new Date().toISOString(),
        null,
        JSON.stringify({
          source: "senangpay-checkout",
          planCode: subscription.plan_code,
        }),
      ],
    );
    const paymentEventId = eventRows.rows[0]?.id;
    if (!paymentEventId) throw new Error("Could not create payment attempt.");

    const orderId = safeOrderId(paymentEventId);
    await client.query(
      `
        update suite_tenant_payment_events
        set reference = $2, metadata = metadata || $3::jsonb, updated_at = now()
        where id = $1
      `,
      [
        paymentEventId,
        orderId,
        JSON.stringify({
          senangpay: {
            orderId,
          },
        }),
      ],
    );

    const checkoutUrl = senangPayCheckoutUrl({
      detail: `${subscription.display_name} subscription`,
      amount: amountForSenangPay(amount),
      orderId,
      name: normalizeContact(input.customerName, "Escal8 Customer"),
      email: normalizeContact(input.customerEmail, "billing@escal8.tech"),
      phone: normalizeContact(input.customerPhone, "0000000000"),
    });

    return { checkoutUrl, orderId };
  });
}

export async function finalizeSenangPayPayment(payload: SenangPayCallbackPayload) {
  const orderId = safeOrderId(payload.orderId);
  if (!orderId) throw new Error("Missing SenangPay order id.");

  return withTransaction("control", async (client) => {
    const rows = await client.query<{
      id: string;
      subscription_id: string;
      suite_tenant_id: string;
      amount: number;
      currency: string;
      status: string;
      due_at: string | null;
      starts_at: string | null;
      current_period_due_at: string | null;
      next_due_at: string | null;
      billing_period_months: number;
    }>(
      `
        select
          p.id,
          p.subscription_id,
          p.suite_tenant_id,
          p.amount,
          p.currency,
          p.status,
          p.due_at::text,
          sub.starts_at::text,
          sub.current_period_due_at::text,
          sub.next_due_at::text,
          plan.billing_period_months
        from suite_tenant_payment_events p
        inner join suite_tenant_subscriptions sub on sub.id = p.subscription_id
        inner join suite_subscription_plans plan on plan.code = sub.plan_code
        where p.reference = $1
        limit 1
      `,
      [orderId],
    );
    const payment = rows.rows[0];
    if (!payment) throw new Error("Payment attempt was not found.");

    // IDEMPOTENCY: Check if this transaction has already been processed
    if (payload.transactionId) {
      const existingPayment = await client.query<{ id: string }>(
        `SELECT id FROM suite_tenant_payment_events
         WHERE metadata->'senangpay'->>'transactionId' = $1
         AND status = 'recorded'
         LIMIT 1`,
        [payload.transactionId],
      );
      if (existingPayment.rows.length > 0) {
        console.log(`[billing] Duplicate transaction_id detected: ${payload.transactionId}, skipping`);
        return { paid: true, suiteTenantId: payment.suite_tenant_id, paymentEventId: existingPayment.rows[0].id, duplicate: true };
      }
    }

    const paid = payload.statusId === "1";
    const paidAt = new Date();
    const dueAnchor =
      (payment.due_at ? new Date(payment.due_at) : null) ??
      (payment.current_period_due_at ? new Date(payment.current_period_due_at) : null) ??
      (payment.next_due_at ? new Date(payment.next_due_at) : null) ??
      (payment.starts_at ? new Date(payment.starts_at) : null) ??
      paidAt;
    const nextDueAt = addMonths(dueAnchor, Number(payment.billing_period_months || 1) || 1);

    await client.query(
      `
        update suite_tenant_payment_events
        set
          status = $2,
          paid_at = case when $2 = 'recorded' then $3::timestamptz else paid_at end,
          metadata = metadata || $4::jsonb,
          updated_at = now()
        where id = $1
      `,
      [
        payment.id,
        paid ? "recorded" : "failed",
        paidAt.toISOString(),
        JSON.stringify({
          senangpay: {
            statusId: payload.statusId,
            transactionId: payload.transactionId,
            message: payload.message,
            raw: payload.raw,
          },
        }),
      ],
    );

    if (paid) {
      await client.query(
        `
          update suite_tenant_subscriptions
          set
            status = 'active',
            last_paid_at = $2::timestamptz,
            current_period_start = $3::timestamptz,
            current_period_due_at = $4::timestamptz,
            next_due_at = $4::timestamptz,
            metadata = metadata || $5::jsonb,
            updated_at = now()
          where id = $1
        `,
        [
          payment.subscription_id,
          paidAt.toISOString(),
          dueAnchor.toISOString(),
          nextDueAt.toISOString(),
          JSON.stringify({
            lastPaymentProvider: "senangpay",
            lastSenangPayTransactionId: payload.transactionId,
          }),
        ],
      );
    }

    return {
      paid,
      suiteTenantId: payment.suite_tenant_id,
      paymentEventId: payment.id,
    };
  });
}

export async function createSenangPayRecurringCheckout(input: RecurringCheckoutInput) {
  return withTransaction("control", async (client) => {
    const planRows = await client.query<{
      code: string;
      display_name: string;
      price_amount: number;
      currency: string;
      billing_period_months: number;
      grant_kind: string;
      metadata: Record<string, unknown> | null;
    }>(
      `
        select code, display_name, price_amount, currency, billing_period_months, grant_kind, metadata
        from suite_subscription_plans
        where code = $1 and is_active = true
        limit 1
      `,
      [input.planCode],
    );
    const plan = planRows.rows[0];
    if (!plan) throw new Error("Plan code was not found.");
    const recurringId = String(plan.metadata?.senangpayRecurringId || "").trim();
    if (!recurringId) throw new Error(`Plan ${plan.code} does not have a SenangPay recurring ID configured.`);

    if (String(plan.grant_kind || "standard") !== "standard") {
      throw new Error("Demo and partner plans are not payable through SenangPay.");
    }

    const existingRows = await client.query<{ id: string }>(
      `
        select id
        from suite_tenant_subscriptions
        where suite_tenant_id = $1
        order by updated_at desc
        limit 1
      `,
      [input.suiteTenantId],
    );

    const now = new Date();
    const dueAt = addMonths(now, Number(plan.billing_period_months || 1) || 1);
    let subscriptionId = existingRows.rows[0]?.id ?? null;

    if (subscriptionId) {
      await client.query(
        `
          update suite_tenant_subscriptions
          set
            plan_code = $2,
            status = case when status = 'active' and plan_code = $2 then status else 'pending_setup' end,
            starts_at = coalesce(starts_at, $3::timestamptz),
            current_period_start = coalesce(current_period_start, $3::timestamptz),
            current_period_due_at = $4::timestamptz,
            next_due_at = $4::timestamptz,
            metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb,
            updated_at = now()
          where id = $1
        `,
        [
          subscriptionId,
          plan.code,
          now.toISOString(),
          dueAt.toISOString(),
          JSON.stringify({ lastCheckoutSource: "senangpay-recurring", recurringId }),
        ],
      );
    } else {
      const created = await client.query<{ id: string }>(
        `
          insert into suite_tenant_subscriptions (
            suite_tenant_id,
            plan_code,
            status,
            starts_at,
            current_period_start,
            current_period_due_at,
            next_due_at,
            metadata
          )
          values ($1, $2, 'pending_setup', $3::timestamptz, $3::timestamptz, $4::timestamptz, $4::timestamptz, $5::jsonb)
          returning id
        `,
        [
          input.suiteTenantId,
          plan.code,
          now.toISOString(),
          dueAt.toISOString(),
          JSON.stringify({ source: "senangpay-recurring-checkout", recurringId }),
        ],
      );
      subscriptionId = created.rows[0]?.id ?? null;
    }

    if (!subscriptionId) throw new Error("Could not create subscription.");

    const subscriptionRows = await client.query<{
      id: string;
      suite_tenant_id: string;
      plan_code: string;
      current_period_due_at: string | null;
      starts_at: string | null;
      next_due_at: string | null;
      price_amount: number;
      currency: string;
      billing_period_months: number;
      display_name: string;
      grant_kind: string;
    }>(
      `
        select
          sub.id,
          sub.suite_tenant_id,
          sub.plan_code,
          sub.current_period_due_at::text,
          sub.starts_at::text,
          sub.next_due_at::text,
          plan.price_amount,
          plan.currency,
          plan.billing_period_months,
          plan.display_name,
          plan.grant_kind
        from suite_tenant_subscriptions sub
        inner join suite_subscription_plans plan on plan.code = sub.plan_code
        where sub.id = $1
        limit 1
      `,
      [subscriptionId],
    );

    const subscription = subscriptionRows.rows[0];
    if (!subscription) throw new Error("Could not load subscription.");

    const amount = Number(subscription.price_amount || 0);
    const eventRows = await client.query<{ id: string }>(
      `
        insert into suite_tenant_payment_events (
          subscription_id,
          suite_tenant_id,
          status,
          amount,
          currency,
          due_at,
          reference,
          metadata
        )
        values ($1, $2, 'pending', $3, $4, $5::timestamptz, $6, $7::jsonb)
        returning id
      `,
      [
        subscription.id,
        subscription.suite_tenant_id,
        amount,
        subscription.currency,
        subscription.current_period_due_at ?? subscription.next_due_at ?? new Date().toISOString(),
        null,
        JSON.stringify({
          source: "senangpay-recurring-checkout",
          planCode: subscription.plan_code,
          recurringId,
        }),
      ],
    );
    const paymentEventId = eventRows.rows[0]?.id;
    if (!paymentEventId) throw new Error("Could not create payment attempt.");

    const orderId = safeOrderId(paymentEventId);
    await client.query(
      `
        update suite_tenant_payment_events
        set reference = $2, metadata = metadata || $3::jsonb, updated_at = now()
        where id = $1
      `,
      [
        paymentEventId,
        orderId,
        JSON.stringify({
          senangpay: {
            orderId,
            recurringId,
          },
        }),
      ],
    );

    const checkoutUrl = senangPayRecurringCheckoutUrl({
      orderId,
      recurringId,
      name: normalizeContact(input.customerName, "Escal8 Customer"),
      email: normalizeContact(input.customerEmail, "billing@escal8.tech"),
      phone: normalizeContact(input.customerPhone, "0000000000"),
    });

    return { checkoutUrl, orderId };
  });
}

// ============================================================
// FINALIZE RECURRING PAYMENT (handles both advance and standard callbacks)
// ============================================================
export async function finalizeSenangPayRecurringPayment(
  payload: (SenangPayRecurringCallbackPayload | SenangPayRecurringStandardCallbackPayload) & { statusId?: "1" | "0" | "3" }
) {
  const orderId = safeOrderId(payload.recurringId);
  if (!orderId) throw new Error("Missing SenangPay recurring reference.");

  return withTransaction("control", async (client) => {
    const rows = await client.query<{
      id: string;
      subscription_id: string;
      suite_tenant_id: string;
      amount: number;
      currency: string;
      status: string;
      due_at: string | null;
      starts_at: string | null;
      current_period_due_at: string | null;
      next_due_at: string | null;
      billing_period_months: number;
    }>(
      `
        select
          p.id,
          p.subscription_id,
          p.suite_tenant_id,
          p.amount,
          p.currency,
          p.status,
          p.due_at::text,
          sub.starts_at::text,
          sub.current_period_due_at::text,
          sub.next_due_at::text,
          plan.billing_period_months
        from suite_tenant_payment_events p
        inner join suite_tenant_subscriptions sub on sub.id = p.subscription_id
        inner join suite_subscription_plans plan on plan.code = sub.plan_code
        where p.metadata->'senangpay'->>'recurringId' = $1
        limit 1
      `,
      [payload.recurringId],
    );
    const payment = rows.rows[0];
    if (!payment) throw new Error("Payment attempt was not found for this recurring ID.");

    // Type narrowing using inline guards
    const isStandard = "action" in payload;
    const stdPayload = isStandard ? payload as SenangPayRecurringStandardCallbackPayload : null;
    const advPayload = !isStandard ? payload as SenangPayRecurringCallbackPayload : null;

    // IDEMPOTENCY: Check if this recurring payment has already been processed
    if (isStandard && stdPayload) {
        const existingPayment = await client.query<{ id: string }>(
          `SELECT id FROM suite_tenant_payment_events
           WHERE metadata->'senangpay'->>'recurringId' = $1
           AND metadata->'senangpay'->>'newPaymentTimestamp' = $2
           AND status = 'recorded'
           LIMIT 1`,
          [stdPayload.recurringId, stdPayload.newPaymentTimestamp],
        );
        if (existingPayment.rows.length > 0) {
          console.log(`[billing] Duplicate recurring payment detected: ${stdPayload.recurringId} at ${stdPayload.newPaymentTimestamp}, skipping`);
          return { paid: true, suiteTenantId: payment.suite_tenant_id, paymentEventId: existingPayment.rows[0].id, duplicate: true };
        }
      } else if (advPayload) {
      // Advance callback
      if (advPayload.recurringId && advPayload.transactionId && advPayload.msg) {

        const existingPayment = await client.query<{ id: string }>(
          `SELECT id FROM suite_tenant_payment_events
           WHERE metadata->'senangpay'->>'recurringId' = $1
           AND metadata->'senangpay'->>'transactionId' = $2
           AND metadata->'senangpay'->>'msg' = $3
           AND status = 'recorded'
           LIMIT 1`,
          [advPayload.recurringId, advPayload.transactionId, advPayload.msg],
        );
        if (existingPayment.rows.length > 0) {
          console.log(`[billing] Duplicate advance recurring payment detected: ${advPayload.recurringId}, skipping`);
          return { paid: true, suiteTenantId: payment.suite_tenant_id, paymentEventId: existingPayment.rows[0].id, duplicate: true };
        }
      }
    }

    // TIMESTAMP VALIDATION: Reject callbacks with timestamp older than 30 minutes
    if (stdPayload?.newPaymentTimestamp) {
      const paymentTime = parseInt(stdPayload.newPaymentTimestamp, 10) * 1000;
      const callbackTime = Date.now();
      const ageMinutes = (callbackTime - paymentTime) / 60000;
      if (ageMinutes > 30) {
        console.warn(`[billing] Recurring callback timestamp too old: ${ageMinutes} minutes`);
      }
    } else if (advPayload?.nextPaymentTimestamp) {
      const paymentTime = parseInt(advPayload.nextPaymentTimestamp, 10) * 1000;
      const callbackTime = Date.now();
      const ageMinutes = (callbackTime - paymentTime) / 60000;
      if (ageMinutes > 30) {
        console.warn(`[billing] Advance callback timestamp too old: ${ageMinutes} minutes`);
      }
    }

    // Determine success based on payload type
    const statusId = payload.statusId ?? "0";
    const paid = statusId === "1";

    const paidAt = new Date();
    const dueAnchor =
      (payment.due_at ? new Date(payment.due_at) : null) ??
      (payment.current_period_due_at ? new Date(payment.current_period_due_at) : null) ??
      (payment.next_due_at ? new Date(payment.next_due_at) : null) ??
      (payment.starts_at ? new Date(payment.starts_at) : null) ??
      new Date();
    const nextDueAt = addMonths(dueAnchor, Number(payment.billing_period_months || 1) || 1);

    // Prepare metadata for payment event - handle both payload types
    const isAdvance = "orderId" in payload && "transactionId" in payload && "msg" in payload;
    const metadataPayload = isAdvance
      ? {
          senangpay: {
            recurringId: payload.recurringId,
            statusId: payload.statusId ?? "0",
            orderId: (payload as SenangPayRecurringCallbackPayload).orderId,
            transactionId: (payload as SenangPayRecurringCallbackPayload).transactionId,
            msg: (payload as SenangPayRecurringCallbackPayload).msg,
            nextPaymentTimestamp: (payload as SenangPayRecurringCallbackPayload).nextPaymentTimestamp,
          },
        }
      : {
          senangpay: {
            action: "action" in payload ? (payload as SenangPayRecurringStandardCallbackPayload).action : undefined,
            recurringId: payload.recurringId,
            type: "type" in payload ? (payload as SenangPayRecurringStandardCallbackPayload).type : undefined,
            customerEmail: "customerEmail" in payload ? (payload as SenangPayRecurringStandardCallbackPayload).customerEmail : undefined,
            newPaymentTimestamp: "newPaymentTimestamp" in payload ? (payload as SenangPayRecurringStandardCallbackPayload).newPaymentTimestamp : undefined,
            statusId: payload.statusId ?? "0",
          },
        };

    await client.query(
      `update suite_tenant_payment_events
        set
          status = $2,
          paid_at = case when $2 = 'recorded' then $3::timestamptz else paid_at end,
          metadata = metadata || $4::jsonb,
          updated_at = now()
        where id = $1`,
      [
        payment.id,
        paid ? "recorded" : "failed",
        new Date().toISOString(),
        JSON.stringify(metadataPayload),
      ],
    );

    if (paid) {
      await client.query(
        `update suite_tenant_subscriptions
          set
            status = 'active',
            last_paid_at = $2::timestamptz,
            current_period_start = $3::timestamptz,
            current_period_due_at = $4::timestamptz,
            next_due_at = $4::timestamptz,
            metadata = metadata || $5::jsonb,
            updated_at = now()
          where id = $1`,
        [
          payment.subscription_id,
          paidAt.toISOString(),
          paidAt.toISOString(),
          nextDueAt.toISOString(),
          JSON.stringify({
            lastPaymentProvider: "senangpay-recurring",
            lastSenangPayTransactionId: payload.recurringId,
            recurringAction: stdPayload?.action,
            recurringStatusId: payload.statusId,
          }),
        ],
      );

      const planRows = await client.query<{ monthly_credits: number }>(
        `select coalesce((p.limits->>'agent.messages.monthly')::integer, 0) as monthly_credits
         from suite_subscription_plans p
         join suite_tenant_subscriptions s on s.plan_code = p.code
         where s.id = $1
         limit 1`,
        [payment.subscription_id],
      );
      const plan = planRows.rows[0];
      if (plan?.monthly_credits > 0) {
        await executeStatement(
          "agent",
          `with target_business as (
             update businesses
             set credit_pool = credit_pool + $2,
                 credit_pool_reset_at = now() + interval '30 days',
                 updated_at = now()
             where suite_tenant_id = $1
             returning id
           )
           update whatsapp_identities wi
           set credit_balance = credit_balance + $2,
               monthly_credit_limit = $2,
               total_credits_topped_up = total_credits_topped_up + $2,
               credit_reset_at = now() + interval '30 days',
               updated_at = now()
           from target_business b
           where wi.business_id = b.id`,
          [payment.suite_tenant_id, plan.monthly_credits],
        );
      }
    } else {
      // Payment failed → immediately mark subscription as past_due
      await client.query(
        `update suite_tenant_subscriptions
          set
            status = 'past_due',
            updated_at = now(),
            metadata = metadata || $1::jsonb
          where id = $2`,
        [
          JSON.stringify({
            auto_past_due: true,
            reason: "recurring_payment_failed",
            failed_at: new Date().toISOString(),
            failed_status_id: payload.statusId ?? "0",
            failed_action: "action" in payload ? (payload as SenangPayRecurringStandardCallbackPayload).action : "unknown",
          }),
          payment.subscription_id,
        ],
      );

      await client.query(
        `INSERT INTO suite_tenant_payment_events (
            subscription_id,
            suite_tenant_id,
            status,
            amount,
            currency,
            due_at,
            reference,
            metadata
          ) VALUES ($1, $2, 'past_due', $3, $4, $5::timestamptz, $6, $7::jsonb)`,
        [
          payment.subscription_id,
          payment.suite_tenant_id,
          payment.amount,
          payment.currency,
          new Date().toISOString(),
          `auto-past-due-${Date.now()}`,
          JSON.stringify({
            source: "webhook-recurring-failed",
            reason: "recurring_payment_failed",
            original_due_at: new Date().toISOString(),
            failed_status_id: payload.statusId ?? "0",
          }),
        ],
      );
    }

    return {
      paid,
      suiteTenantId: payment.suite_tenant_id,
      paymentEventId: payment.id,
    };
  });
}

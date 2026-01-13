"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { CustomersTable } from "./components/CustomersTable";
import { CustomerDrawer } from "./components/CustomerDrawer";

export default function CustomersPage() {
  // Store selected customer as source + externalId
  const [selectedCustomer, setSelectedCustomer] = useState<{
    source: string;
    externalId: string;
  } | null>(null);
  
  const { data: customers, isLoading } = trpc.customers.list.useQuery();
  
  const customer = customers?.find(
    (c) => c.source === selectedCustomer?.source && c.externalId === selectedCustomer?.externalId
  );

  return (
    <main style={{ padding: 32 }}>
      {isLoading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          Loading customers...
        </div>
      ) : !customers?.length ? (
        <div
          className="glass"
          style={{
            textAlign: "center",
            padding: 60,
            color: "var(--muted)",
          }}
        >
          <p style={{ fontSize: 18, marginBottom: 8 }}>No customers yet</p>
          <p style={{ fontSize: 14, opacity: 0.7 }}>
            Customers will appear here when they message you.
          </p>
        </div>
      ) : (
        <CustomersTable
          rows={customers}
          onSelect={(source, externalId) => setSelectedCustomer({ source, externalId })}
        />
      )}

      <CustomerDrawer
        customer={customer ?? null}
        onClose={() => setSelectedCustomer(null)}
      />
    </main>
  );
}

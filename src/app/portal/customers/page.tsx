"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { CustomersTable } from "./components/CustomersTable";
import { CustomerDrawer } from "./components/CustomerDrawer";

export default function CustomersPage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  const { data: customers, isLoading } = trpc.customers.list.useQuery();
  
  const selectedCustomer = customers?.find(
    (c) => c.waId === selectedCustomerId
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
            Customers will appear here when they message your WhatsApp number.
          </p>
        </div>
      ) : (
        <CustomersTable
          rows={customers}
          onSelect={(waId) => setSelectedCustomerId(waId)}
        />
      )}

      <CustomerDrawer
        customer={selectedCustomer ?? null}
        onClose={() => setSelectedCustomerId(null)}
      />
    </main>
  );
}

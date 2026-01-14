"use client";

import { useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { CustomersTable } from "./components/CustomersTable";
import { CustomerDrawer } from "./components/CustomerDrawer";
import type { CustomerRow, Source } from "./types";

export default function CustomersPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  // Store selected customer by ID
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  const { data: customers, isLoading } = trpc.customers.list.useQuery(
    selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : undefined
  );
  
  // Cast the source field to Source type (it comes as string from the DB)
  const typedCustomers = customers?.map((c) => ({
    ...c,
    source: c.source as Source,
  })) as CustomerRow[] | undefined;
  
  const customer = typedCustomers?.find((c) => c.id === selectedCustomerId);

  return (
    <main style={{ padding: 32 }}>
      {isLoading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
          Loading customers...
        </div>
      ) : !typedCustomers?.length ? (
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
          rows={typedCustomers}
          onSelect={(id) => setSelectedCustomerId(id)}
        />
      )}

      <CustomerDrawer
        customer={customer ?? null}
        onClose={() => setSelectedCustomerId(null)}
      />
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { CustomersTable } from "./components/CustomersTable";
import { CustomerDrawer } from "./components/CustomerDrawer";
import type { CustomerRow, Source } from "./types";

export default function CustomersPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  const PAGE_SIZE = 200;
  // Store selected customer by ID
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ updatedAt: string; id: string } | null>(null);
  const [extraRows, setExtraRows] = useState<CustomerRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const baseFilter = useMemo(
    () => (selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    [selectedPhoneNumberId],
  );
  const firstInput = useMemo(
    () => ({ ...baseFilter, limit: PAGE_SIZE }),
    [baseFilter],
  );

  useLivePortalEvents({ customerListInput: firstInput });
  const { data: customers, isFetching } = trpc.customers.list.useQuery(firstInput);

  const pageInput = useMemo(
    () =>
      cursor
        ? {
            ...baseFilter,
            limit: PAGE_SIZE,
            cursorUpdatedAt: cursor.updatedAt,
            cursorId: cursor.id,
          }
        : undefined,
    [baseFilter, cursor],
  );
  const pagedQuery = trpc.customers.list.useQuery(pageInput as any, {
    enabled: Boolean(pageInput),
  });

  useEffect(() => {
    setCursor(null);
    setExtraRows([]);
    setHasMore(false);
    setIsLoadingMore(false);
  }, [selectedPhoneNumberId]);

  useEffect(() => {
    if (!customers) return;
    setHasMore(customers.length === PAGE_SIZE);
  }, [customers]);

  useEffect(() => {
    if (!isLoadingMore || !pagedQuery.data) return;
    setExtraRows((prev) => {
      const map = new Map<string, CustomerRow>();
      for (const row of prev) map.set(row.id, row);
      for (const row of pagedQuery.data as CustomerRow[]) map.set(row.id, row);
      return Array.from(map.values());
    });
    setHasMore(pagedQuery.data.length === PAGE_SIZE);
    setIsLoadingMore(false);
  }, [isLoadingMore, pagedQuery.data]);

  const listRows = useMemo(() => {
    const first = (customers ?? []) as CustomerRow[];
    if (!extraRows.length) return first;
    const map = new Map<string, CustomerRow>();
    for (const row of first) map.set(row.id, row);
    for (const row of extraRows) if (!map.has(row.id)) map.set(row.id, row);
    return Array.from(map.values());
  }, [customers, extraRows]);
  
  // Cast the source field to Source type (it comes as string from the DB)
  const typedCustomers = listRows?.map((c) => ({
    ...c,
    source: c.source as Source,
  })) as CustomerRow[];
  
  const customer = typedCustomers?.find((c) => c.id === selectedCustomerId);

  const handleLoadMore = () => {
    if (isLoadingMore || !typedCustomers.length) return;
    const last = typedCustomers[typedCustomers.length - 1];
    if (!last?.updatedAt || !last?.id) return;
    const updatedAtIso = new Date(last.updatedAt as unknown as string).toISOString();
    setCursor({ updatedAt: updatedAtIso, id: last.id });
    setIsLoadingMore(true);
  };

  return (
    <main style={{ padding: 32 }}>
      {!typedCustomers?.length ? (
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
          listInput={firstInput}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore || isFetching}
          onLoadMore={handleLoadMore}
        />
      )}

      <CustomerDrawer
        customer={customer ?? null}
        onClose={() => setSelectedCustomerId(null)}
      />
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/utils/trpc";
import { usePhoneFilter } from "@/components/PhoneFilterContext";
import { useLivePortalEvents } from "@/app/portal/hooks/useLivePortalEvents";
import { useRouter, useSearchParams } from "next/navigation";
import { CustomersTable } from "./components/CustomersTable";
import { CustomerDrawer } from "./components/CustomerDrawer";
import type { CustomerRow, Source } from "./types";

const PAGE_SIZE = 20;
type CustomerSortKey = "source" | "name" | "lastMessageAt";

function CustomersPageContent({ selectedPhoneNumberId }: { selectedPhoneNumberId: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<Source | "all">("all");
  const [sortKey, setSortKey] = useState<CustomerSortKey>("lastMessageAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const baseFilter = useMemo(
    () => (selectedPhoneNumberId ? { whatsappIdentityId: selectedPhoneNumberId } : {}),
    [selectedPhoneNumberId],
  );
  const pageInput = useMemo(
    () => ({
      ...baseFilter,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: searchQuery.trim() || undefined,
      source: sourceFilter !== "all" ? sourceFilter : undefined,
      sortKey,
      sortDir,
    }),
    [baseFilter, page, searchQuery, sortDir, sortKey, sourceFilter],
  );

  useLivePortalEvents({ customerPageInput: pageInput });
  const customersPageQuery = trpc.customers.listPage.useQuery(pageInput);

  const typedCustomers = useMemo(
    () =>
      ((customersPageQuery.data?.items ?? []) as CustomerRow[]).map((c) => ({
        ...c,
        source: c.source as Source,
      })) as CustomerRow[],
    [customersPageQuery.data?.items],
  );
  const totalCount = customersPageQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  useEffect(() => {
    if (safePage !== page) {
      queueMicrotask(() => setPage(safePage));
    }
  }, [page, safePage]);

  const queryCustomerId = String(searchParams?.get("customerId") || "").trim();
  const effectiveSelectedCustomerId = selectedCustomerId || queryCustomerId || null;
  const selectedCustomerQuery = trpc.customers.get.useQuery(
    { id: effectiveSelectedCustomerId ?? "" },
    {
      enabled: Boolean(effectiveSelectedCustomerId) && !typedCustomers.some((customer) => customer.id === effectiveSelectedCustomerId),
    },
  );
  const customer = typedCustomers.find((c) => c.id === effectiveSelectedCustomerId)
    ?? ((selectedCustomerQuery.data ? {
      ...selectedCustomerQuery.data,
      source: selectedCustomerQuery.data.source as Source,
    } : null) as CustomerRow | null);

  return (
    <main
      style={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {totalCount === 0 ? (
        <div
          style={{
            flex: 1,
            textAlign: "center",
            padding: 60,
            color: "var(--muted)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
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
          totalCount={totalCount}
          page={safePage}
          totalPages={totalPages}
          searchQuery={searchQuery}
          onSearchQueryChange={(value) => {
            setSearchQuery(value);
            setPage(0);
          }}
          sourceFilter={sourceFilter}
          onSourceFilterChange={(value) => {
            setSourceFilter(value);
            setPage(0);
          }}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={(nextKey) => {
            setPage(0);
            if (sortKey === nextKey) {
              setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
              return;
            }
            setSortKey(nextKey);
            setSortDir("desc");
          }}
          onPageChange={setPage}
          onSelect={(id) => setSelectedCustomerId(id)}
          pageInput={pageInput}
          countsInput={baseFilter}
        />
      )}

      <CustomerDrawer
        customer={customer ?? null}
        onClose={() => {
          setSelectedCustomerId(null);
          if (queryCustomerId) {
            router.replace("/customers");
          }
        }}
      />
    </main>
  );
}

export default function CustomersPage() {
  const { selectedPhoneNumberId } = usePhoneFilter();
  return (
    <CustomersPageContent
      key={selectedPhoneNumberId ?? "all"}
      selectedPhoneNumberId={selectedPhoneNumberId}
    />
  );
}

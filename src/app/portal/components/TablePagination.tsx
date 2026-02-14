"use client";

type TablePaginationProps = {
  page: number;
  totalPages: number;
  shownCount: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  pageLabelSuffix?: string;
};

export function TablePagination({
  page,
  totalPages,
  shownCount,
  totalCount,
  onPrev,
  onNext,
  canPrev,
  canNext,
  pageLabelSuffix,
}: TablePaginationProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 18px",
        borderTop: "1px solid var(--border)",
        marginTop: "auto",
      }}
    >
      <span className="text-muted" style={{ fontSize: 12 }}>
        Showing {shownCount} of {totalCount}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={onPrev} disabled={!canPrev}>
          Prev
        </button>
        <span className="text-muted" style={{ minWidth: 98, textAlign: "center", fontSize: 12 }}>
          Page {page + 1} / {totalPages}{pageLabelSuffix ? pageLabelSuffix : ""}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onNext} disabled={!canNext}>
          Next
        </button>
      </div>
    </div>
  );
}


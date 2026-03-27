"use client";

function buildPageItems(page: number, totalPages: number): Array<number | string> {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, idx) => idx + 1);

  const current = page + 1;
  const items: Array<number | string> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);

  if (start > 2) items.push("...");
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < totalPages - 1) items.push("...");
  items.push(totalPages);
  return items;
}

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
  onPageChange?: (page: number) => void;
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
  onPageChange,
}: TablePaginationProps) {
  const pageItems = buildPageItems(page, totalPages);

  return (
    <div className="portal-pagination">
      <button className="portal-pagination__button portal-pagination__button--prev" onClick={onPrev} disabled={!canPrev}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
        Previous
      </button>
      <div className="portal-pagination__pages" aria-label="Pagination">
        {pageItems.map((item, index) =>
          item === "..." ? (
            <span key={`ellipsis-${index}`} className="portal-pagination__ellipsis">
              ...
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`portal-pagination__page${page + 1 === item ? " is-active" : ""}`}
              onClick={() => {
                const targetPage = Number(item) - 1;
                if (onPageChange) {
                  onPageChange(targetPage);
                  return;
                }
                if (targetPage < page) onPrev();
                if (targetPage > page) onNext();
              }}
              disabled={page + 1 === item}
              aria-label={`Go to page ${item}`}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <button className="portal-pagination__button portal-pagination__button--next" onClick={onNext} disabled={!canNext}>
        Next
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      <span className="portal-pagination__summary" aria-hidden="true">
        Showing {shownCount} of {totalCount}
        {pageLabelSuffix ? ` • ${pageLabelSuffix}` : ""}
      </span>
    </div>
  );
}

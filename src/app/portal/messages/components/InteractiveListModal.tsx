"use client";

import type { InteractiveListSection } from "@/app/portal/messages/interactiveMessage";

export function InteractiveListPanel({
  title,
  subtitle,
  sections,
  selectedReplyId,
}: {
  title: string;
  subtitle?: string;
  sections: InteractiveListSection[];
  selectedReplyId?: string | null;
}) {
  const normalizedSelected = String(selectedReplyId || "").trim().toLowerCase();

  return (
    <div className="wa-thread-message__list-panel" role="region" aria-label={title}>
      {subtitle ? <div className="wa-thread-message__list-panel-subtitle">{subtitle}</div> : null}
      <div
        className="wa-thread-message__interactive-stack is-attached is-list-panel is-readonly"
        aria-label={title}
      >
        <div className="wa-thread-message__interactive-stack-label">List sent to customer</div>
        {sections.map((section, sectionIndex) =>
          section.rows.map((row) => {
            const rowId = String(row.id || "").trim().toLowerCase();
            const selected =
              normalizedSelected &&
              (rowId === normalizedSelected ||
                rowId.endsWith(normalizedSelected) ||
                normalizedSelected.endsWith(rowId));

            return (
              <div
                key={`${section.title || "section"}-${sectionIndex}-${row.id}`}
                className={`wa-thread-message__interactive-option is-readonly${selected ? " is-selected" : ""}`}
                aria-current={selected ? "true" : undefined}
              >
                <span className="wa-thread-message__interactive-option-icon" aria-hidden="true">
                  ↩
                </span>
                <span className="wa-thread-message__interactive-option-copy">
                  <span className="wa-thread-message__interactive-option-title">{row.title}</span>
                  {row.description ? (
                    <span className="wa-thread-message__interactive-option-description">{row.description}</span>
                  ) : null}
                </span>
                {selected ? <span className="wa-thread-message__interactive-option-badge">Selected</span> : null}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
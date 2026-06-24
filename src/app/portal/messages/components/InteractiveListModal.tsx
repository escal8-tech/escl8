"use client";

import type { InteractiveListSection } from "@/app/portal/messages/interactiveMessage";

export function InteractiveListModal({
  open,
  title,
  subtitle,
  sections,
  selectedReplyId,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  sections: InteractiveListSection[];
  selectedReplyId?: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  const normalizedSelected = String(selectedReplyId || "").trim().toLowerCase();

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose} aria-hidden="true" />
      <div className="portal-modal-shell wa-list-modal-shell" role="dialog" aria-modal="true" aria-label={title}>
        <div className="portal-modal-card wa-list-modal-card">
          <div className="portal-modal-card__body wa-list-modal-card__body">
            <div className="wa-list-modal__header">
              <div>
                <div className="wa-list-modal__title">{title}</div>
                {subtitle ? <div className="wa-list-modal__subtitle">{subtitle}</div> : null}
              </div>
              <button type="button" className="btn btn-ghost wa-list-modal__close" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="wa-list-modal__sections">
              {sections.map((section, sectionIndex) => (
                <div key={`${section.title || "section"}-${sectionIndex}`} className="wa-list-modal__section">
                  {section.title ? <div className="wa-list-modal__section-title">{section.title}</div> : null}
                  <div className="wa-list-modal__rows">
                    {section.rows.map((row) => {
                      const rowId = String(row.id || "").trim().toLowerCase();
                      const selected =
                        normalizedSelected &&
                        (rowId === normalizedSelected ||
                          rowId.endsWith(normalizedSelected) ||
                          normalizedSelected.endsWith(rowId));
                      return (
                        <div
                          key={row.id}
                          className={`wa-list-modal__row${selected ? " is-selected" : ""}`}
                          aria-current={selected ? "true" : undefined}
                        >
                          <div className="wa-list-modal__row-main">
                            <div className="wa-list-modal__row-title">{row.title}</div>
                            {row.description ? (
                              <div className="wa-list-modal__row-description">{row.description}</div>
                            ) : null}
                          </div>
                          {selected ? <span className="wa-list-modal__row-badge">Selected</span> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
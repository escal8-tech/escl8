"use client";

import type { CSSProperties, ReactNode } from "react";
import { TableSearchControl } from "./TableToolbarControls";

type PortalDataTableProps = {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    style?: CSSProperties;
  };
  countText?: string;
  endControls?: ReactNode;
  toolbarNoWrap?: boolean;
  children: ReactNode;
  footer?: ReactNode;
};

export function PortalDataTable({
  search,
  countText,
  endControls,
  toolbarNoWrap = false,
  children,
  footer,
}: PortalDataTableProps) {
  return (
    <main className="portal-table-surface">
      <div className="portal-table-toolbar" style={toolbarNoWrap ? { flexWrap: "nowrap" } : undefined}>
        {search ? (
          <TableSearchControl
            value={search.value}
            onChange={search.onChange}
            placeholder={search.placeholder}
            style={search.style}
          />
        ) : (
          <div style={{ marginRight: "auto" }} />
        )}

        {(countText || endControls) && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {countText ? (
              <p style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{countText}</p>
            ) : null}
            {endControls}
          </div>
        )}
      </div>

      <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
        {children}
      </div>

      {footer}
    </main>
  );
}


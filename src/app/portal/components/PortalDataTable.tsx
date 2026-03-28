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
      <div className={`portal-table-toolbar${toolbarNoWrap ? " portal-table-toolbar--nowrap" : ""}`}>
        {search ? (
          <div className="portal-table-toolbar__search">
            <TableSearchControl
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
              style={search.style}
            />
          </div>
        ) : (
          <div className="portal-table-toolbar__spacer" />
        )}

        {(countText || endControls) && (
          <div className="portal-table-toolbar__end">
            {countText ? (
              <p className="portal-meta-text portal-table-toolbar__count">{countText}</p>
            ) : null}
            {endControls}
          </div>
        )}
      </div>

      <div className="portal-table-body">
        {children}
      </div>

      {footer}
    </main>
  );
}

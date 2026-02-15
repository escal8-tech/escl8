"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

type RowActionItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type RowActionsMenuProps = {
  ariaLabel?: string;
  items: RowActionItem[];
};

export function RowActionsMenu({ ariaLabel = "Row actions", items }: RowActionsMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1px solid rgba(212,168,75,0.45)",
            background: "linear-gradient(135deg, rgba(0,51,160,0.28), rgba(212,168,75,0.16))",
            color: "#f8e7be",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={8}
          align="end"
          onClick={(e) => e.stopPropagation()}
          style={{
            minWidth: 170,
            background: "rgba(8, 10, 16, 0.98)",
            border: "1px solid rgba(212,168,75,0.45)",
            borderRadius: 10,
            boxShadow: "0 20px 38px rgba(0,0,0,0.45)",
            overflow: "hidden",
            padding: 4,
            zIndex: 4000,
          }}
        >
          {items.map((item, index) => (
            <DropdownMenu.Item
              key={`${item.label}-${index}`}
              disabled={item.disabled}
              onSelect={() => {
                item.onSelect();
              }}
              style={{
                padding: "9px 10px",
                borderRadius: 7,
                fontSize: 14,
                color: item.disabled ? "rgba(232,237,249,0.45)" : item.danger ? "#fda4af" : "#e8edf9",
                cursor: item.disabled ? "not-allowed" : "pointer",
                userSelect: "none",
                outline: "none",
              }}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

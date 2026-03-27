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
          className="portal-dropdown-trigger"
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
          className="portal-dropdown-content"
        >
          {items.map((item, index) => (
            <DropdownMenu.Item
              key={`${item.label}-${index}`}
              disabled={item.disabled}
              onSelect={() => {
                item.onSelect();
              }}
              className="portal-dropdown-item"
              style={item.danger ? { color: "#f87171" } : undefined}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

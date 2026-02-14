"use client";

import type { CSSProperties } from "react";
import * as Select from "@radix-ui/react-select";

export type PortalSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type PortalSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: PortalSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  className?: string;
};

export function PortalSelect({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  id,
  ariaLabel,
  style,
  className,
}: PortalSelectProps) {
  return (
    <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={`portal-select-trigger${className ? ` ${className}` : ""}`}
        style={style}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="portal-select-content" position="popper" sideOffset={6}>
          <Select.Viewport className="portal-select-viewport">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="portal-select-item"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="portal-select-item-indicator">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

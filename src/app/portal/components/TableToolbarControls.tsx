"use client";

import { Children, isValidElement, type CSSProperties, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { PortalSelect } from "./PortalSelect";

type TableSearchControlProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  style?: CSSProperties;
};

export function TableSearchControl({ value, onChange, placeholder, style }: TableSearchControlProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        height: 44,
        padding: "0 10px",
        margin: "8px 0",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        ...style,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        className="portal-table-search-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          color: "var(--foreground)",
          outline: "none",
          boxShadow: "none",
          fontSize: 14,
          minWidth: 0,
        }}
      />
    </div>
  );
}

type TableSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  compact?: boolean;
};

function readOptionLabel(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(readOptionLabel).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return readOptionLabel(node.props.children);
  return "";
}

export function TableSelect({ children, className, ...props }: TableSelectProps) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children?: ReactNode }>(child)) return [];
    if (child.type !== "option") return [];
    const value = String(child.props.value ?? "");
    const label = readOptionLabel(child.props.children);
    return [{ value, label, disabled: child.props.disabled }];
  });

  const currentValue = props.value == null ? "" : String(props.value);
  const onChange = props.onChange;

  return (
    <PortalSelect
      value={currentValue}
      onValueChange={(next) => {
        if (!onChange) return;
        onChange({ target: { value: next } } as ChangeEvent<HTMLSelectElement>);
      }}
      options={options}
      disabled={props.disabled}
      id={props.id}
      ariaLabel={props["aria-label"]}
      style={props.style}
      className={className}
    />
  );
}

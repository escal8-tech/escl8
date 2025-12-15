export type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

export type DocSlot = { key: DocType; title: string; hint: string; accept: string };

export type ExistingMap = Partial<Record<DocType, { name: string; size: number } | null>>;

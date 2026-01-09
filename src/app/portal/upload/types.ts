export type DocType = "considerations" | "conversations" | "inventory" | "bank" | "address";

export type DocSlot = { key: DocType; title: string; hint: string; accept: string };

export type ExistingDoc = {
	name: string;
	size: number;
	indexingStatus?: string;
	lastIndexedAt?: string | null;
	lastError?: string | null;
	uploadedAt?: string | null;
};

export type ExistingMap = Partial<Record<DocType, ExistingDoc | null>>;

import type { DocSlot, DocType, IndexingStatus } from "@/lib/rag-documents";

export type { DocSlot, DocType };

export type ExistingDoc = {
	name: string;
	size: number;
	indexingStatus?: IndexingStatus | string;
	lastIndexedAt?: string | null;
	lastError?: string | null;
	uploadedAt?: string | null;
};

export type ExistingMap = Partial<Record<DocType, ExistingDoc | null>>;

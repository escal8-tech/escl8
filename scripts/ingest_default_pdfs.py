import os
from index_documents import index_inputs

# Canonical filenames we expect; we'll filter by those that exist
_CANDIDATES = [
    "AI AGENT CONSIDERATION.pdf",
    "AI AGENT CONVERSATION.pdf",
    "AI AGENT LIVE STOCK LIST.pdf",
    "BANK ACCOUNT DETAILS.pdf",
    "SHOP ADDRESS AND LOCATION.pdf"
]

def _gather_pdfs() -> list:
    found = []
    for name in _CANDIDATES:
        if os.path.isfile(name):
            found.append(name)
    # Also include any matching patterns in current dir (fallback)
    for fn in os.listdir("."):
        low = fn.lower()
        if low.endswith(".pdf") and any(k in low for k in ["consideration", "conversation", "promotion", "promo", "bank", "address", "location", "live stock", "stock list"]):
            if fn not in found:
                found.append(fn)
    return found


if __name__ == "__main__":
    pdfs = _gather_pdfs()
    if not pdfs:
        raise SystemExit("No expected PDFs found in repo root. Place the PDFs or update the gather logic.")

    biz = os.getenv("BUSINESS_ID", "social")
    purge = os.getenv("PURGE_NAMESPACE", "true").lower() in ("1", "true", "yes")
    print(f"Indexing {len(pdfs)} PDFs for business_id='{biz}' (purge={purge})...")
    index_inputs(pdfs, namespace=biz, purge=purge)
    print(f"Done. Ingested PDFs into Pinecone namespace '{biz}'.")

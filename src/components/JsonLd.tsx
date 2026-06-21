import type { JsonLdObject } from "@/lib/seo";

type JsonLdProps = {
  data: JsonLdObject | JsonLdObject[];
};

export default function JsonLd({ data }: JsonLdProps) {
  // Deeply escape characters that can be used for script injection in JSON-LD
  const sanitized = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

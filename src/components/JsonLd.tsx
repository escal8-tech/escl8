import type { JsonLdObject } from "@/lib/seo";
import { escapeJsonForHtml } from "@/lib/security";

type JsonLdProps = {
  data: JsonLdObject | JsonLdObject[];
};

export default function JsonLd({ data }: JsonLdProps) {
  const jsonString = JSON.stringify(data);
  const sanitized = escapeJsonForHtml(jsonString);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

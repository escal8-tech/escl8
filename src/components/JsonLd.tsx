import type { JsonLdObject } from "@/lib/seo";

type JsonLdProps = {
  data: JsonLdObject | JsonLdObject[];
};

export default function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

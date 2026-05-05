import type { Metadata } from "next";

export const conciergeSeo = {
  name: "Escal8 Concierge",
  brandName: "Escal8",
  legalName: "Escalate Tech Services Sdn Bhd",
  url: "https://concierge.escal8.tech",
  mainSiteUrl: "https://www.escal8.tech",
  mainProductUrl: "https://www.escal8.tech/concierge",
  logoPath: "/favikon.png",
  ogImagePath: "/landing/hero-dashboard.png",
  email: "hello@escal8.tech",
  privacyEmail: "privacy@escal8.tech",
  legalEmail: "legal@escal8.tech",
  sameAs: [
    "https://www.escal8.tech/concierge",
    "https://www.escal8.tech/concierge/about",
    "https://www.escal8.tech/concierge/answers",
    "https://www.escal8.tech/concierge/profiles",
    "https://www.escal8.tech/profiles",
    "https://www.linkedin.com/company/escal8concierge/",
    "https://www.crunchbase.com/organization/escal8",
    "https://www.instagram.com/escal8.tech/",
  ],
  description:
    "Escal8 Concierge is an AI customer operations app for WhatsApp, web chat, social inboxes, lead capture, support handoff, ticket workflows, and manager visibility.",
  standardDescription:
    "Escal8 Concierge is an AI customer operations app from Escal8 for WhatsApp, web chat, social inboxes, lead capture, support handoff, ticket workflows, and manager visibility.",
  keywords: [
    "Escal8 Concierge",
    "Escal8",
    "Escal8 Tech",
    "AI concierge app",
    "WhatsApp AI agent",
    "AI customer operations",
    "AI support handoff",
    "multi-channel inbox",
    "customer support automation",
    "lead capture automation",
  ],
};

export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | JsonLdObject
  | JsonLdValue[];

export type JsonLdObject = {
  [key: string]: JsonLdValue;
};

export function absoluteUrl(path = "/") {
  if (path.startsWith("http")) {
    return path;
  }

  return new URL(path, conciergeSeo.url).toString();
}

export function buildMetadata({
  title,
  description,
  path,
  imagePath,
  keywords = [],
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  imagePath?: string;
  keywords?: string[];
  index?: boolean;
}): Metadata {
  const canonical = absoluteUrl(path);
  const image = absoluteUrl(imagePath ?? conciergeSeo.ogImagePath);

  return {
    title,
    description,
    keywords: Array.from(new Set([...conciergeSeo.keywords, ...keywords])),
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      siteName: conciergeSeo.name,
      title,
      description,
      url: canonical,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${conciergeSeo.name} dashboard preview`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    robots: {
      index,
      follow: index,
      googleBot: {
        index,
        follow: index,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
  };
}

export function organizationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://www.escal8.tech/#organization",
    name: conciergeSeo.brandName,
    legalName: conciergeSeo.legalName,
    alternateName: [
      "Escal8",
      "Escal8 Tech",
      "Escal8 Concierge",
    ],
    url: conciergeSeo.mainSiteUrl,
    logo: "https://www.escal8.tech/favicon-512x512.png",
    description:
      "Escal8 is an AI automation company specializing in AI concierge agents, WhatsApp reservation systems, and customer operations software for hospitality and customer-facing businesses.",
    sameAs: conciergeSeo.sameAs.filter((url) => !url.includes("concierge.escal8.tech")),
  };
}

export function conciergeSoftwareJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": absoluteUrl("/#software"),
    name: conciergeSeo.name,
    alternateName: ["Escal8 AI Concierge"],
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: conciergeSeo.url,
    image: absoluteUrl(conciergeSeo.ogImagePath),
    description: conciergeSeo.description,
    brand: {
      "@id": "https://www.escal8.tech/#organization",
    },
    publisher: {
      "@id": "https://www.escal8.tech/#organization",
    },
    sameAs: conciergeSeo.sameAs,
    featureList: [
      "WhatsApp AI customer conversations",
      "Web chat and social inbox support",
      "Lead capture and qualification",
      "Human handoff and ticket workflows",
      "Customer context and manager visibility",
      "Operational reporting for support and revenue teams",
    ],
    audience: {
      "@type": "BusinessAudience",
      audienceType: "Customer-facing businesses, support teams, sales teams, and SME operators",
    },
  };
}

export function websiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    name: conciergeSeo.name,
    alternateName: ["Escal8", "Escal8 Tech", "Escal8 Concierge"],
    url: conciergeSeo.url,
    description: conciergeSeo.description,
    publisher: {
      "@id": "https://www.escal8.tech/#organization",
    },
    inLanguage: "en",
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

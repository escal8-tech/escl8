import type { Metadata } from "next";
import { Montserrat, Catamaran, Inter } from "next/font/google";
import TopNavSwitcher from "../components/TopNavSwitcher";
import FooterSwitcher from "@/components/FooterSwitcher";
import SentryTestButton from "@/components/SentryTestButton";
import { TRPCProvider } from "@/utils/trpc";
import { ToastProvider } from "@/components/ToastProvider";
import { absoluteUrl, conciergeSeo } from "@/lib/seo";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const catamaran = Catamaran({
  variable: "--font-catamaran",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});


export const metadata: Metadata = {
  metadataBase: new URL(conciergeSeo.url),
  applicationName: conciergeSeo.name,
  creator: conciergeSeo.legalName,
  publisher: conciergeSeo.legalName,
  title: {
    default: "Escal8 Concierge | AI WhatsApp Agent & Customer Operations App",
    template: "%s | Escal8",
  },
  description: conciergeSeo.description,
  keywords: conciergeSeo.keywords,
  alternates: {
    canonical: absoluteUrl("/"),
  },
  openGraph: {
    type: "website",
    siteName: conciergeSeo.name,
    title: "Escal8 Concierge | AI WhatsApp Agent & Customer Operations App",
    description: conciergeSeo.description,
    url: conciergeSeo.url,
    images: [
      {
        url: absoluteUrl(conciergeSeo.ogImagePath),
        width: 1200,
        height: 630,
        alt: "Escal8 Concierge AI customer operations dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Escal8 Concierge | AI WhatsApp Agent & Customer Operations App",
    description: conciergeSeo.description,
    images: [absoluteUrl(conciergeSeo.ogImagePath)],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  icons: [
    { rel: "icon", url: "/favikon.png", type: "image/png" },
    { rel: "apple-touch-icon", url: "/favikon.png" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${montserrat.variable} ${catamaran.variable} ${inter.variable}`}>
        <TRPCProvider>
          <ToastProvider>
            <TopNavSwitcher />
            <main className="site-main">{children}</main>
            <FooterSwitcher />
            <SentryTestButton />
          </ToastProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}

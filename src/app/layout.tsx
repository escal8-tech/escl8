import type { Metadata } from "next";
import { Montserrat, Catamaran } from "next/font/google";
import TopNavSwitcher from "../components/TopNavSwitcher";
import FooterSwitcher from "@/components/FooterSwitcher";
import { TRPCProvider } from "@/utils/trpc";
import { ToastProvider } from "@/components/ToastProvider";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const catamaran = Catamaran({
  variable: "--font-catamaran",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});


export const metadata: Metadata = {
  title: "Escl8 — Human-like AI Sales Agents for WhatsApp & Web",
  description:
    "Escl8 builds fully customized, human-like AI sales and support agents for SMBs and enterprises. Upload your docs, connect WhatsApp, and go live fast.",
  metadataBase: new URL("http://localhost:5000"),
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
      <body className={`${montserrat.variable} ${catamaran.variable}`}>
        <TRPCProvider>
          <ToastProvider>
            <TopNavSwitcher />
            <main className="site-main">{children}</main>
            <FooterSwitcher />
          </ToastProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}

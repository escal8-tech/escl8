import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});


export const metadata: Metadata = {
  title: "escl8 — Human-like AI Sales Agents for WhatsApp & Web",
  description:
    "escl8 builds fully customized, human-like AI sales and support agents for SMBs and enterprises. Upload your docs, connect WhatsApp, and go live fast.",
  metadataBase: new URL("http://localhost:5000"),
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${figtree.variable}`}>
        <Nav />
        <main className="site-main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

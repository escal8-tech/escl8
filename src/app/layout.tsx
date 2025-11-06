import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "escl8 — Human-like AI Sales Bots for WhatsApp & Web",
  description:
    "escl8 builds fully customized, human-like AI sales and support bots for SMBs and enterprises. Upload your docs, connect WhatsApp, and go live fast.",
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Nav />
        <main className="site-main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

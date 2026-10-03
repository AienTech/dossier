import type { Metadata } from "next";
import { connection } from "next/server";

import { Toaster } from "@/components/toast";
import { fontVariables } from "@/fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dossier", template: "%s · Dossier" },
  description: "Your job search, on your server.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: its scripts carry that request's CSP nonce (E11-5).
  await connection();
  return (
    <html lang="en" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

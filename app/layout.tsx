import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Ripline", description: "x" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="font-body text-white antialiased">{children}</body></html>);
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Somtoday login",
  description: "Pick a school, sign in, and view student information.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

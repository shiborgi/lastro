import { themeVariables } from "@lastro/ui/tokens";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Lastro",
  description: "Self-hosted financial platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`:root{${themeVariables("light")}}`}</style>
      </head>
      <body
        style={{
          margin: 0,
          background: "var(--lastro-background)",
          color: "var(--lastro-text)",
          fontFamily: "var(--lastro-font-sans)",
        }}
      >
        {children}
      </body>
    </html>
  );
}

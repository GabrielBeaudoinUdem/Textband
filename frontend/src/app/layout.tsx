import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TextBand — DAW Text Editor",
  description: "A DAW-inspired text editor for HCI research. Manipulate text blocks like audio clips with phonetic MIDI visualization.",
};

import { ExperienceLogProvider } from "@/components/ExperienceLogProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ExperienceLogProvider>
          {children}
        </ExperienceLogProvider>
      </body>
    </html>
  );
}

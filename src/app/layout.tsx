import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dayframe — Offline Local-AI MacBook Calendar Organizer",
  description:
    "100% offline MacBook calendar organizer: queues lightweight screenshots at 0 MB AI RAM, wakes local Valen-Decision + Gemma 4 only a few times a day, and asks before scheduling uncertain items.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}

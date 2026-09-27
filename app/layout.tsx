import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui";

export const metadata: Metadata = {
  title: "Grind Squad",
  description: "Daily habits, friendly competition.",
  applicationName: "Grind Squad",
  appleWebApp: { capable: true, title: "Grind Squad", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#09090f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

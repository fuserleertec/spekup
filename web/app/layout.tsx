import "./globals.css";
import { Fraunces, Inter } from "next/font/google";
import { Shell } from "@/components/shell";
import { publicBaseUrl } from "@/lib/site";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });

export function generateMetadata() {
  const site = publicBaseUrl();
  return {
    metadataBase: new URL(site),
    title: "Spekup — neighbors in civic life",
    description: "A community space for sharing, mutual aid, and practical civic action among neighbors. Not a government agency or official record.",
    applicationName: "Spekup",
    icons: {
      icon: [
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    robots: { index: false, follow: false },
    openGraph: {
      title: "Spekup — neighbors in civic life",
      description: "Discover. Share. Help. Thrive. Not a government agency.",
      url: "/",
      siteName: "Spekup",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Spekup — neighbors in civic life",
      description: "Discover. Share. Help. Thrive.",
    },
  };
}

export const viewport = { themeColor: "#17372D", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${serif.variable} font-sans antialiased`}>
        <Shell />
        <div className="hidden">{children}</div>
        <noscript><p className="p-6 text-center">Spekup needs JavaScript for the neighborhood feed.</p></noscript>
      </body>
    </html>
  );
}

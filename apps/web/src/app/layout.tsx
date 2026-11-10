import "./globals.css";
import { Providers } from "../components/providers";
export const metadata = {
  title: "UsageAudit",
  description: "Independent usage-based billing verification",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "@/lib/auth";
export const metadata: Metadata = { title: "Bronze Snake Warehouse", description: "Preston warehouse tools" };
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en"><body>
      <header className="top">
        <a className="brand" href="/">BRONZE SNAKE · WAREHOUSE</a>
        {user && <div className="who"><span>{user}</span><form method="post" action="/api/logout"><button className="secondary" style={{ padding: "4px 10px", fontSize: 13 }}>Sign out</button></form></div>}
      </header>
      <main>{children}</main>
    </body></html>
  );
}

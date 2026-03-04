import "./globals.css";

export const metadata = {
  title: "SavorIQ — Guest Intelligence Hub",
  description:
    "Third Space Guest Intelligence Hub connecting F&B order history with multi-platform review sentiment.",
};

import Sidebar from "@/components/Sidebar";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          <Sidebar />

          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}

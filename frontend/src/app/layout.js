import "./globals.css";

export const metadata = {
  title: "SavorIQ — Guest Intelligence Hub",
  description:
    "Third Space Guest Intelligence Hub connecting F&B order history with multi-platform review sentiment.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-layout">
          <aside className="sidebar">
            <div className="sidebar-logo">
              <div className="logo-icon">🧠</div>
              <div>
                <h1>SavorIQ</h1>
                <span className="subtitle">Guest Intelligence</span>
              </div>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Main</div>
              <a href="/" className="nav-link active">
                <span className="icon">📊</span> Dashboard
              </a>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Intelligence</div>
              <a href="/intercepts" className="nav-link">
                <span className="icon">🚨</span> Priority Inbox
              </a>
              <a href="/guests" className="nav-link">
                <span className="icon">👤</span> Guest Registry
              </a>
              <a href="/reviews" className="nav-link">
                <span className="icon">💬</span> Reviews
              </a>
            </div>

            <div className="nav-section">
              <div className="nav-section-title">Analysis</div>
              <a href="/" className="nav-link">
                <span className="icon">🎯</span> Sentiment
              </a>
              <a href="/" className="nav-link">
                <span className="icon">📈</span> Analytics
              </a>
            </div>
          </aside>

          <main className="main-content">{children}</main>
        </div>
      </body>
    </html>
  );
}

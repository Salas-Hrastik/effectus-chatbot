import { getTenantConfig } from '@/lib/tenant';

const tenant = getTenantConfig();

export const metadata = {
  title: `${tenant.institutionName} — AI Informator`,
  description: tenant.description,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; height: 100dvh; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f0f4f9;
            color: #1a2332;
            -webkit-font-smoothing: antialiased;
          }
          button { font-family: inherit; }
          input { font-family: inherit; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #c5d3e8; border-radius: 99px; }
          ::-webkit-scrollbar-thumb:hover { background: #9ab3d4; }

          /* dvh — dynamic viewport height (accounts for mobile browser chrome / keyboard) */
          .app-wrapper { height: 100vh; height: 100dvh; }

          /* ── Responsive / Mobile ─────────────────────────────────────── */
          @media (max-width: 640px) {
            /* Navbar */
            .app-navbar { padding: 0 10px !important; }
            .app-navbar-title { font-size: 15px !important; }
            .app-navbar-link { display: none !important; }

            /* Main wrapper */
            .app-main { padding: 6px 8px !important; }

            /* Hero card */
            .hero-section { padding: 14px 16px 12px !important; border-radius: 12px !important; }
            .hero-logo { display: none !important; }
            .hero-title { font-size: 1.35rem !important; }
            .hero-desc { font-size: 13px !important; }
            .hero-badge { font-size: 12px !important; }
            .hero-prompts { gap: 6px !important; margin-top: 10px !important; }
            .hero-prompts button { font-size: 13px !important; padding: 7px 12px !important; }

            /* Chat area */
            .chat-section { border-radius: 12px !important; }
            .chat-messages { padding: 12px 10px !important; gap: 8px !important; }
            .chat-avatar { width: 28px !important; height: 28px !important; font-size: 13px !important; min-width: 28px; }
            .chat-bubble { padding: 12px 14px !important; font-size: 15px !important; max-width: 88% !important; }
            .chat-bubble-label { font-size: 11px !important; margin-bottom: 5px !important; }

            /* Input bar */
            .input-bar { padding: 10px 10px !important; }
            .input-field { padding: 10px 12px !important; font-size: 15px !important; border-radius: 10px !important; }
            .mic-btn { width: 40px !important; height: 40px !important; border-radius: 10px !important; }
            .send-btn { padding: 10px 14px !important; min-width: unset !important; font-size: 14px !important; border-radius: 10px !important; }
            .input-disclaimer { display: none !important; }
          }

          @media (max-width: 400px) {
            .app-navbar-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .chat-bubble { max-width: 92% !important; }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

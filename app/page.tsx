export const dynamic = 'force-dynamic';

import { ChatWindow } from '@/components/ChatWindow';
import { getTenantConfig } from '@/lib/tenant';

export default function HomePage() {
  const tenant = getTenantConfig();

  return (
    <div className="app-wrapper" style={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Navbar */}
      <header className="app-navbar" style={{
        background: '#2ea3f2',
        padding: '0 20px',
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 10px rgba(46,163,242,0.30)',
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/effectus-logo.png"
            alt="Effectus"
            style={{ height: 34, width: 'auto', borderRadius: 5 }}
          />
          <span className="app-navbar-title" style={{ color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em' }}>
            EFFECTUS veleučilište
          </span>
        </div>
        <a
          href="https://effectus.com.hr"
          target="_blank"
          rel="noopener noreferrer"
          className="app-navbar-link"
          style={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
            padding: '5px 12px',
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.25)',
          }}
        >
          effectus.com.hr ↗
        </a>
      </header>

      {/* Main — fills remaining viewport height */}
      <main className="app-main" style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 1140,
        width: '100%',
        margin: '0 auto',
        padding: '12px 24px',
        overflow: 'hidden',
      }}>
        <ChatWindow
          institutionName={tenant.institutionName}
          description={tenant.description}
          heroPrompts={[
            'Kolika je školarina?',
            'Kako se upisati na Effectus?',
            'Koji studijski programi postoje?',
            'Koji su rokovi upisa?',
            'Koje programe cjeloživotnog obrazovanja nudite?',
          ]}
        />
      </main>
    </div>
  );
}

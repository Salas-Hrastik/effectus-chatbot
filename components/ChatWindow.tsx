'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatWindowProps = {
  institutionName: string;
  description?: string;
  heroPrompts?: string[];
};

const BRAND = '#4a5568';
const BRAND_DARK = '#2d3748';
const BRAND_LIGHT = '#edf2f7';

// Module-level slot — the mounted ChatWindow registers its openPopup callback here.
// All link handlers across parseInline / SitePreview / renderContent call this
// without needing prop-drilling.
let _openPopup: ((url: string) => void) | null = null;

function openSourcePopup(url: string) {
  if (_openPopup) { _openPopup(url); return; }
  // Fallback (no component mounted yet): plain new tab
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// IframePopup — in-page overlay with iframe (not blocked by popup blockers)
// Closes on ✕ button, backdrop click, or ESC key.
// ---------------------------------------------------------------------------
function IframePopup({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  let favicon = '';
  try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; } catch { /* noop */ }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(8,16,36,0.58)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
        animation: 'fadeInOverlay 0.18s ease',
      }}
    >
      <style>{`
        @keyframes fadeInOverlay { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInPopup  { from { transform: translateY(18px); opacity: 0 }
                                    to   { transform: translateY(0);    opacity: 1 } }
      `}</style>
      <div style={{
        width: 'min(780px, 92vw)', height: 'min(600px, 84vh)',
        background: '#fff', borderRadius: 14,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 28px 72px rgba(0,0,0,0.38)',
        animation: 'slideInPopup 0.22s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 12px', height: 44,
          background: BRAND, flexShrink: 0,
        }}>
          {favicon && <img src={favicon} width={14} height={14} alt="" style={{ borderRadius: 3, flexShrink: 0, opacity: 0.9 }} />}
          <span style={{
            color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: 500,
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {url}
          </span>
          <button
            onClick={onClose}
            title="Zatvori (ESC)"
            style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 7,
              border: 'none', background: 'rgba(255,255,255,0.16)',
              color: '#fff', fontSize: 16, lineHeight: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.14s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.30)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.16)')}
          >
            ✕
          </button>
        </div>
        {/* Page frame */}
        <iframe
          src={url}
          style={{ flex: 1, border: 'none', width: '100%' }}
          title="Pregled izvora"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeacherPhoto — lazy-loads a real photo from /api/teacher-photo,
// falls back to PersonAvatar (initials) while loading or on error.
// Module-level cache so the same teacher isn't fetched twice per page session.
// ---------------------------------------------------------------------------
const photoUrlCache = new Map<string, string | null>();

function TeacherPhoto({ name, size = 22 }: { name: string; size?: number }) {
  const [photoUrl, setPhotoUrl] = useState<string | null | undefined>(
    photoUrlCache.has(name) ? photoUrlCache.get(name) : undefined
  );

  useEffect(() => {
    if (photoUrlCache.has(name)) { setPhotoUrl(photoUrlCache.get(name) ?? null); return; }
    let cancelled = false;
    fetch(`/api/teacher-photo?name=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then((d: { photo?: string | null }) => {
        const url = d.photo ?? null;
        photoUrlCache.set(name, url);
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => { photoUrlCache.set(name, null); if (!cancelled) setPhotoUrl(null); });
    return () => { cancelled = true; };
  }, [name]);

  if (photoUrl) return <RealPhoto url={photoUrl} name={name} size={size} />;
  return <PersonAvatar name={name} size={size} />;
}

function parseInline(text: string): ReactNode[] {
  // Split on **bold** and bare URLs — both get special rendering
  const parts = text.split(/(https?:\/\/[^\s,،、。\)]+|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (/^https?:\/\//.test(part)) {
      // Clickable URL → opens in popup window (stays in chat after close)
      return (
        <a
          key={i}
          href={part}
          onClick={e => { e.preventDefault(); openSourcePopup(part); }}
          style={{
            color: BRAND,
            textDecoration: 'underline',
            cursor: 'pointer',
            wordBreak: 'break-all',
          }}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ---------------------------------------------------------------------------
// RealPhoto — real person photo with initials-avatar fallback
// ---------------------------------------------------------------------------
function RealPhoto({ url, name, size = 48 }: { url: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (err) return <PersonAvatar name={name} size={size} />;
  return (
    <img
      src={url}
      width={size}
      height={size}
      loading="lazy"
      alt={name}
      title={name}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block', objectFit: 'cover', objectPosition: 'top' }}
      onError={() => setErr(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// PersonAvatar — initials-based avatar generated via ui-avatars.com
// ---------------------------------------------------------------------------
function PersonAvatar({ name, size = 34 }: { name: string; size?: number }) {
  // Strip titles so initials reflect the actual name (e.g. "dr. sc." → skip)
  const clean = name
    .replace(/\b(dr|mr|mag|univ|spec|prof|dipl|bacc|oec|sc|ing|phon|russ|bibl)\b\.?\s*/gi, '')
    .replace(/,.*$/, '')
    .trim();
  const src = `https://ui-avatars.com/api/?name=${encodeURIComponent(clean)}&background=0f62fe&color=fff&size=${size * 2}&bold=true&rounded=true`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      loading="lazy"
      alt={clean}
      title={name}
      style={{ borderRadius: '50%', flexShrink: 0, display: 'block' }}
    />
  );
}

// ---------------------------------------------------------------------------
// SitePreview — compact link-chip shown below source links
// Intentionally small so it reads as a "temporary preview", not a permanent widget.
// ---------------------------------------------------------------------------
function SitePreview({ url }: { url: string }) {
  let domain = url;
  let path = '';
  try {
    const u = new URL(url);
    domain = u.hostname;
    path = u.pathname.replace(/\/$/, ''); // strip trailing slash
  } catch { /* noop */ }
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  // Short readable path — last 2 segments, max 38 chars
  const pathLabel = path.split('/').filter(Boolean).slice(-2).join(' › ');
  const label = pathLabel.length > 0
    ? (pathLabel.length > 38 ? pathLabel.slice(0, 36) + '…' : pathLabel)
    : domain;

  return (
    <div
      onClick={() => openSourcePopup(url)}
      title={url}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        marginTop: 8, padding: '5px 10px 5px 8px',
        borderRadius: 20,            /* pill shape → clearly "temporary" */
        border: '1px solid #c5d8ff',
        background: '#f4f8ff',
        cursor: 'pointer',
        maxWidth: 280,
        transition: 'background 0.15s, box-shadow 0.15s',
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = '#e6efff';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 8px #0f62fe18';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = '#f4f8ff';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      <img src={favicon} width={13} height={13} alt="" style={{ flexShrink: 0, borderRadius: 2, opacity: 0.85 }} />
      <span style={{
        fontSize: 12, color: '#1a4fba', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {/* External link arrow */}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
        <path d="M1 9L9 1M9 1H4M9 1V6" stroke="#1a4fba" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// extractPersonName — detect a person's name from a rendered line
// ---------------------------------------------------------------------------
function extractPersonName(line: string): string | null {
  const t = line.trim();

  // "👤 **Name, Title**" or "👤 Label: Name Surname"
  const m1 = t.match(/^👤\s+(?:\*\*)?(?:\w+:\s*)?([A-ZŠĐŽČĆ][a-zšđčćž]+(?:\s+[A-ZŠĐŽČĆ][a-zšđčćžA-ZŠĐŽČĆ\-]+)+)/);
  if (m1) return m1[1].trim();

  // "   Name Surname[, title] | 📞" — indented staff contact lines
  if (!t.startsWith('•') && !t.startsWith('🔹') && !t.startsWith('📞') &&
      !t.startsWith('📧') && !t.startsWith('🕒') && !t.startsWith('📍')) {
    const m2 = t.match(/^([A-ZŠĐŽČĆ][a-zšđčćž]+\s+[A-ZŠĐŽČĆ][a-zšđčćžA-ZŠĐŽČĆ\-]+(?:\s+[A-ZŠĐŽČĆ][a-zšđčćžA-ZŠĐŽČĆ\-]+)?)(?:,|\s*\|)/);
    if (m2) return m2[1].trim();
  }

  // "• Subject – [Title] FirstName LastName" — teacher bullet entries
  const m3 = t.match(/^[•\-]\s+.+?\s+[–\-]\s+(?:(?:dr|mr|prof|mag|univ|spec)\.\s+(?:sc\.\s+)?)?([A-ZŠĐŽČĆ][a-zšđčćž]+\s+[A-ZŠĐŽČĆ][a-zšđčćžA-ZŠĐŽČĆ\-]+)/);
  if (m3) return m3[1].trim();

  return null;
}

function renderContent(content: string, onSuggestion?: (q: string) => void): ReactNode[] {
  const lines = content.split('\n');
  // Detect suggestion block boundaries: after "Mogu vam pomoći" header
  const suggestionLineNums = new Set<number>();
  let inSuggBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.includes('Mogu vam pomoći') || t.includes('mogu vam pomoći')) {
      inSuggBlock = true;
      continue;
    }
    if (inSuggBlock) {
      // a numbered line like "1. ..." or "1️⃣ ..." (supports up to 99 items)
      if (/^[1-9]\d?[.)]?\s+.{5,}/.test(t) || /^\d️⃣/.test(t)) {
        suggestionLineNums.add(i);
      } else if (t && !t.match(/^\d+[.)]/)) {
        // non-numbered non-empty line ends suggestion block
        inSuggBlock = false;
      }
    }
  }

  return lines.map((line, i) => {
    const trimmed = line.trim();

    // Source link + site preview thumbnail (handles 🔹, 📋, or bare "Izvor:" prefix)
    const srcMatch = trimmed.match(/^(?:(?:🔹|📋)\s*)?Izvor:\s*(https?:\/\/\S+)$/i);
    if (srcMatch) {
      const url = srcMatch[1];
      return (
        <div key={i}>
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 10,
            background: BRAND_LIGHT, border: `1px solid #c5d8ff`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 13, color: BRAND_DARK, fontWeight: 600 }}>🔹 Izvor:</span>
            <button type="button" onClick={() => openSourcePopup(url)} style={{
              background: 'transparent', border: 'none', padding: 0, margin: 0,
              color: BRAND, cursor: 'pointer', textDecoration: 'underline',
              fontWeight: 600, wordBreak: 'break-all', textAlign: 'left',
              fontSize: 13, fontFamily: 'inherit',
            }}>
              {url}
            </button>
          </div>
          <SitePreview url={url} />
        </div>
      );
    }

    // Numbered suggestion — emoji digit OR "N. " format inside suggestion block
    const emojiSuggMatch = trimmed.match(/^(\d️⃣)\s+(.+)$/u);
    const numDotSuggMatch = suggestionLineNums.has(i)
      ? trimmed.match(/^([1-9]\d?)[.)]\s+(.+)$/)
      : null;

    const suggMatch = emojiSuggMatch ?? numDotSuggMatch;
    if (suggMatch && onSuggestion) {
      // Strip any " — description" suffix the AI might append after the actual question
      const raw = suggMatch[2].trim();
      const question = raw.split(/\s+[—–-]\s+/)[0].trim();
      const label = emojiSuggMatch ? suggMatch[1] : `${suggMatch[1]}.`;
      return (
        <div key={i} style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => onSuggestion(question)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 999,
              border: `1.5px solid ${BRAND}`, background: BRAND_LIGHT,
              color: BRAND_DARK, fontWeight: 600, cursor: 'pointer',
              fontSize: 15, lineHeight: 1.4, transition: 'background 0.15s',
              textAlign: 'left',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#d0e2ff')}
            onMouseLeave={e => (e.currentTarget.style.background = BRAND_LIGHT)}
          >
            <span style={{ opacity: 0.7, fontWeight: 700 }}>{label}</span>
            {question}
          </button>
        </div>
      );
    }

    // "Mogu vam pomoći i s:" header — render as subtle label
    if (trimmed.includes('Mogu vam pomoći') || trimmed.includes('mogu vam pomoći')) {
      return (
        <div key={i} style={{
          marginTop: 14, marginBottom: 4,
          fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
          color: '#7a90b0', textTransform: 'uppercase',
        }}>
          {trimmed}
        </div>
      );
    }

    // 👤 Person header line — show real photo (if [PHOTO:URL] marker present) or initials avatar
    if (trimmed.startsWith('👤')) {
      const photoMatch = trimmed.match(/\[PHOTO:(https?:\/\/[^\]]+)\]/);
      const photoUrl = photoMatch ? photoMatch[1] : null;
      const cleanedLine = trimmed.replace(/\[PHOTO:[^\]]+\]/, '');
      const personName = extractPersonName(cleanedLine);
      const label = cleanedLine.replace(/^👤\s*/, '');
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 2px' }}>
          {photoUrl
            ? <RealPhoto url={photoUrl} name={personName || label} size={48} />
            : personName && <PersonAvatar name={personName} size={36} />
          }
          <span style={{ fontWeight: 600 }}>{parseInline(label)}</span>
        </div>
      );
    }

    // Staff contact line: "Name Surname[, title] | 📞 ..." — show small avatar
    if (!trimmed.startsWith('•') && !trimmed.startsWith('🔹') && !trimmed.startsWith('📞') &&
        !trimmed.startsWith('📧') && !trimmed.startsWith('🕒') && !trimmed.startsWith('📍') &&
        trimmed.includes('|') && (trimmed.includes('📞') || trimmed.includes('📧'))) {
      const personName = extractPersonName(trimmed);
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', paddingLeft: 4 }}>
          {personName && <TeacherPhoto name={personName} size={28} />}
          <span style={{ fontSize: 14 }}>{parseInline(trimmed)}</span>
        </div>
      );
    }

    // Bullet — teacher entries "• Subject – Name" get a small avatar next to the name
    const bulletMatch = trimmed.match(/^[•\-]\s+(.+)$/);
    if (bulletMatch) {
      const content = bulletMatch[1];
      const hasDash = content.includes(' – ') || content.includes(' - ');
      const personName = hasDash ? extractPersonName('• ' + content) : null;
      if (personName) {
        // Render subject and name parts separately so avatar sits next to the name
        const sep = content.includes(' – ') ? ' – ' : ' - ';
        const sepIdx = content.indexOf(sep);
        const subject = sepIdx >= 0 ? content.slice(0, sepIdx) : '';
        const nameAndTitle = sepIdx >= 0 ? content.slice(sepIdx + sep.length) : content;
        return (
          <div key={i} style={{ marginBottom: 5, paddingLeft: 4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: BRAND, fontWeight: 700, flexShrink: 0, marginTop: 5 }}>•</span>
            <span style={{ flex: 1, lineHeight: 1.5 }}>
              {subject && <span style={{ opacity: 0.8 }}>{parseInline(subject)}</span>}
              {subject && <span style={{ color: '#aaa', margin: '0 5px' }}>–</span>}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
                <TeacherPhoto name={personName} size={22} />
                <span>{parseInline(nameAndTitle)}</span>
              </span>
            </span>
          </div>
        );
      }
      return (
        <div key={i} style={{ marginBottom: 4, paddingLeft: 4, display: 'flex', gap: 8 }}>
          <span style={{ color: BRAND, fontWeight: 700, flexShrink: 0 }}>•</span>
          <span>{parseInline(content)}</span>
        </div>
      );
    }

    if (!trimmed) return <div key={i} style={{ height: 6 }} />;

    // Dense teacher/program line: multiple " – " entries concatenated in one blob → split into bullet items.
    // Guards:
    //   1. Requires 2+ em-dashes (bio text with a single aside like "X – Y" is excluded)
    //   2. After splitting, at least 2 parts must contain " – " (confirms they're teacher entries, not sentences)
    const emDashCount = (trimmed.match(/ – /g) ?? []).length;
    if (trimmed.length > 120 && emDashCount >= 2) {
      const parts = trimmed.split(/(?<=[a-zšđčćž.,)\]]{2,})(?=[A-ZŠĐŽČĆ][a-zšđčćž])/g)
        .map(p => p.trim()).filter(p => p.length > 4);
      const teacherLikeParts = parts.filter(p => p.includes(' – '));
      if (parts.length > 1 && teacherLikeParts.length >= 2) {
        return (
          <div key={i} style={{ marginBottom: 4 }}>
            {parts.map((part, pi) => {
              const pName = extractPersonName('• ' + part);
              const sep = part.includes(' – ') ? ' – ' : ' - ';
              const si = part.indexOf(sep);
              const subj = si >= 0 ? part.slice(0, si) : '';
              const nameT = si >= 0 ? part.slice(si + sep.length) : part;
              return (
                <div key={pi} style={{ display: 'flex', gap: 8, marginBottom: 5, paddingLeft: 4, alignItems: 'flex-start' }}>
                  <span style={{ color: BRAND, fontWeight: 700, flexShrink: 0, marginTop: 4 }}>•</span>
                  <span style={{ flex: 1 }}>
                    {subj && <span style={{ opacity: 0.8 }}>{parseInline(subj)}</span>}
                    {subj && <span style={{ color: '#aaa', margin: '0 5px' }}>–</span>}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, verticalAlign: 'middle' }}>
                      {pName && <TeacherPhoto name={pName} size={22} />}
                      <span>{parseInline(nameT)}</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      }
    }

    return <div key={i} style={{ marginBottom: 4 }}>{parseInline(line)}</div>;
  });
}

function resolveNumericShortcut(question: string, messages: Message[]): string {
  if (!/^\d+$/.test(question.trim())) return question;
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim());
  if (!last) return question;
  const map: Record<string, string> = {};
  let inSugg = false;
  for (const line of last.content.split('\n')) {
    const t = line.trim();
    if (t.includes('Mogu vam pomoći')) { inSugg = true; continue; }
    // emoji format
    const em = t.match(/^(\d)️⃣\s+(.+)$/u);
    if (em) { map[em[1]] = em[2].trim(); continue; }
    // "N. " format inside suggestion block (supports up to 99 items)
    if (inSugg) {
      const nm = t.match(/^([1-9]\d?)[.)]\s+(.+)$/);
      if (nm) { map[nm[1]] = nm[2].trim(); continue; }
      if (t && !t.match(/^\d+[.)]/)) inSugg = false;
    }
  }
  return map[question.trim()] || question;
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: BRAND,
          display: 'inline-block',
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function ChatWindow({ institutionName, description, heroPrompts = [] }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [heroVisible, setHeroVisible] = useState(true);
  // In-page popup (iframe overlay)
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMsgCountRef = useRef(0);

  // Register this component's openPopup handler so static helpers (parseInline,
  // SitePreview, renderContent) can open the in-page iframe overlay.
  useEffect(() => {
    _openPopup = (url: string) => setPopupUrl(url);
    return () => { _openPopup = null; };
  }, []);

  // Track manual scroll — if user scrolls up, stop auto-scrolling
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUpRef.current = !nearBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const newPair = messages.length > prevMsgCountRef.current &&
      messages[messages.length - 1]?.role === 'assistant';
    prevMsgCountRef.current = messages.length;

    if (newPair) {
      // New Q&A: scroll to show the user message at the top — response reads top-to-bottom
      userScrolledUpRef.current = false;
      requestAnimationFrame(() => {
        if (lastUserMsgRef.current) {
          lastUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
    // No auto-scroll during streaming — user reads from top and scrolls down manually
  }, [messages]);

  // ── Voice recording helpers ──────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording) { stopRecording(); return; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer webm/opus (best Whisper support), fallback to whatever browser supports
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks to release microphone indicator
        stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        setIsTranscribing(true);

        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
          const file = new File([blob], `recording.${ext}`, { type: mimeType });

          const fd = new FormData();
          fd.append('audio', file);

          const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
          const data = await res.json();

          if (data.text) {
            setInput(data.text);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        } catch {
          // Silent fail — user can just type instead
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      // Microphone access denied or not available — do nothing, button stays inactive
    }
  }, [isRecording, stopRecording]);

  async function submitQuestion(question: string) {
    if (!question.trim() || loading) return;
    const resolved = resolveNumericShortcut(question, messages).trim();
    if (!resolved) return;

    // Collapse hero on first question
    if (messages.length === 0) setHeroVisible(false);

    const userMsg: Message = { role: 'user', content: resolved };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.body) throw new Error('Nema odgovora sa servera.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let full = '';
      while (!done) {
        const { done: d, value } = await reader.read();
        done = d;
        full += decoder.decode(value || new Uint8Array(), { stream: !done });
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: full };
          return copy;
        });
      }
    } catch {
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: 'Došlo je do pogreške pri dohvaćanju odgovora. Pokušajte ponovo.' };
        return copy;
      });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>

      {/* Hero card — collapses after first question */}
      <section className="hero-section" style={{
        flexShrink: 0,
        background: `linear-gradient(135deg, #4a5568 0%, #2d3748 60%, #1a202c 100%)`,
        color: '#fff',
        borderRadius: 16,
        padding: heroVisible ? '20px 28px 18px' : '0',
        boxShadow: heroVisible ? `0 4px 20px rgba(15,98,254,0.22)` : 'none',
        maxHeight: heroVisible ? '420px' : '0',
        overflow: 'hidden',
        marginBottom: heroVisible ? undefined : -8,
        transition: 'max-height 0.4s ease, padding 0.3s ease, box-shadow 0.3s ease, margin 0.3s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hero-badge" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.18)',
              borderRadius: 999, padding: '3px 11px',
              fontSize: 13, fontWeight: 600,
              marginBottom: 8, letterSpacing: '0.02em',
            }}>
              <span>✦</span>
              <span>AI Informator</span>
            </div>

            <h1 className="hero-title" style={{
              fontSize: 'clamp(1.5rem, 3.5vw, 2.3rem)',
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              marginBottom: 6,
            }}>
              {institutionName}
            </h1>

            <p className="hero-desc" style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.9, maxWidth: 620 }}>
              Postavite pitanje o upisima, školarini,
              studijskim programima i cjeloživotnom obrazovanju.
            </p>
          </div>

          <div className="hero-logo" style={{ flexShrink: 0 }}>
            <img
              src="/effectus-logo.png"
              alt="Effectus"
              style={{ width: 200, height: 'auto', display: 'block' }}
            />
          </div>
        </div>

        {/* Quick prompts */}
        {heroPrompts.length > 0 && (
          <div className="hero-prompts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {heroPrompts.map(p => (
              <button key={p} type="button" onClick={() => submitQuestion(p)}
                disabled={loading}
                style={{
                  padding: '8px 16px', borderRadius: 999,
                  border: '1.5px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.16)',
                  color: '#fff', fontWeight: 600, fontSize: 14,
                  cursor: loading ? 'default' : 'pointer',
                  backdropFilter: 'blur(6px)',
                  transition: 'background 0.15s',
                  opacity: loading ? 0.6 : 1,
                }}>
                {p}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Chat area — fills remaining height */}
      <section className="chat-section" style={{
        flex: 1,
        minHeight: 0,
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #dde6f5',
        boxShadow: '0 2px 16px rgba(15,98,254,0.06)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* Messages — fills all available space */}
        <div ref={scrollRef} className="chat-messages" style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 20px',
          background: '#f7f9fd',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {messages.length === 0 ? (
            <div style={{
              margin: 'auto',
              textAlign: 'center',
              padding: '32px 20px',
              color: '#7a90b0',
            }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>🎓</div>
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
                Dobrodošli na Effectus AI Informator
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.65, maxWidth: 420, margin: '0 auto' }}>
                Upišite pitanje ili odaberite jednu od ponuđenih tema iznad.
              </div>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              // Track the last user message so we can scroll to it when response starts
              const isLastUserMsg = isUser && (i === messages.length - 2 || i === messages.length - 1);
              return (
                <div key={i}
                  ref={isLastUserMsg ? lastUserMsgRef : undefined}
                  style={{
                  display: 'flex',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end',
                  gap: 10,
                }}>
                  {/* AI avatar */}
                  {!isUser && (
                    <div className="chat-avatar" style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: BRAND,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16, flexShrink: 0,
                      boxShadow: `0 4px 12px rgba(15,98,254,0.25)`,
                    }}>
                      ✦
                    </div>
                  )}

                  {/* Bubble */}
                  <div className="chat-bubble" style={{
                    maxWidth: '82%',
                    padding: '16px 22px',
                    borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: isUser ? BRAND : '#fff',
                    color: isUser ? '#fff' : '#1a2332',
                    border: isUser ? 'none' : '1px solid #dde6f5',
                    boxShadow: isUser
                      ? `0 4px 18px rgba(15,98,254,0.22)`
                      : '0 2px 12px rgba(0,0,0,0.06)',
                    fontSize: 16, lineHeight: 1.7,
                  }}>
                    <div className="chat-bubble-label" style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                      marginBottom: 8,
                      opacity: isUser ? 0.75 : 1,
                      color: isUser ? 'rgba(255,255,255,0.8)' : BRAND,
                    }}>
                      {isUser ? 'VI' : 'EFFECTUS AI'}
                    </div>

                    {msg.content === '' && loading && i === messages.length - 1
                      ? <TypingDots />
                      : <div>{renderContent(msg.content, submitQuestion)}</div>
                    }
                  </div>

                  {/* User avatar */}
                  {isUser && (
                    <div className="chat-avatar" style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: '#dde9ff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 17, flexShrink: 0,
                    }}>
                      👤
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Input bar */}
        <div className="input-bar" style={{
          flexShrink: 0,
          padding: '14px 20px',
          borderTop: '1px solid #e8eef8',
          background: '#fff',
        }}>
          <form onSubmit={e => { e.preventDefault(); submitQuestion(input); }}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isTranscribing ? 'Prepisujem govor…' : isRecording ? 'Slušam… kliknite za zaustavljanje' : 'Upišite pitanje ili kliknite mikrofon…'}
              disabled={loading || isTranscribing}
              className="input-field"
              style={{
                flex: 1, padding: '12px 18px',
                borderRadius: 12,
                border: `1.5px solid ${isRecording ? '#e53935' : loading ? '#dde6f5' : '#c5d5f0'}`,
                fontSize: 15, outline: 'none',
                background: loading || isTranscribing ? '#f7f9fd' : '#fff',
                color: '#1a2332',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = isRecording ? '#e53935' : BRAND}
              onBlur={e => e.target.style.borderColor = isRecording ? '#e53935' : '#c5d5f0'}
            />

            {/* Microphone / voice input button */}
            <button
              type="button"
              className="mic-btn"
              onClick={startRecording}
              disabled={loading || isTranscribing}
              title={isRecording ? 'Zaustavi snimanje' : 'Glasovni unos'}
              style={{
                width: 46, height: 46,
                borderRadius: 12,
                border: `1.5px solid ${isRecording ? '#e53935' : '#c5d5f0'}`,
                background: isRecording ? '#fff0f0' : '#f7f9fd',
                color: isRecording ? '#e53935' : loading || isTranscribing ? '#aabcd8' : '#5a7aab',
                cursor: loading || isTranscribing ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.15s',
                position: 'relative',
              }}
            >
              {isTranscribing ? (
                /* Spinner while Whisper transcribes */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/>
                  </path>
                </svg>
              ) : isRecording ? (
                /* Stop square while recording */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#e53935">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                  {/* Pulsing ring */}
                  <circle cx="12" cy="12" r="10" fill="none" stroke="#e53935" strokeWidth="1.5" opacity="0.4">
                    <animate attributeName="r" values="10;13;10" dur="1s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.4;0;0.4" dur="1s" repeatCount="indefinite"/>
                  </circle>
                </svg>
              ) : (
                /* Microphone icon */
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="11" rx="3"/>
                  <path d="M5 10a7 7 0 0 0 14 0"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="9" y1="22" x2="15" y2="22"/>
                </svg>
              )}
            </button>

            <button type="submit" disabled={loading || isTranscribing || !input.trim()} className="send-btn" style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: 'none',
              background: loading || isTranscribing || !input.trim() ? '#c5d5f0' : BRAND,
              color: '#fff',
              fontWeight: 700, fontSize: 15,
              cursor: loading || isTranscribing || !input.trim() ? 'default' : 'pointer',
              transition: 'background 0.15s',
              flexShrink: 0,
              minWidth: 100,
            }}>
              {loading ? '…' : 'Pošalji →'}
            </button>
          </form>
          <div className="input-disclaimer" style={{ marginTop: 8, fontSize: 12, color: '#9aabca', textAlign: 'center' }}>
            Odgovori temeljeni isključivo na javno dostupnim izvorima · Zero hallucination
          </div>
        </div>
      </section>

      {/* In-page popup overlay — rendered on top of everything when a link is clicked */}
      {popupUrl && (
        <IframePopup url={popupUrl} onClose={() => setPopupUrl(null)} />
      )}
    </div>
  );
}

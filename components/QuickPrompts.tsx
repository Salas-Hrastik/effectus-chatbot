'use client';

const PROMPTS = [
  'Kolika je školarina?',
  'Kako izgleda procedura upisa?',
  'Postoji li online studij?',
  'Koji su rokovi upisa?',
  'Koji studijski programi postoje?',
  'Koje programe cjeloživotnog obrazovanja nudite?',
];

export function QuickPrompts() {
  function ask(prompt: string) {
    window.dispatchEvent(
      new CustomEvent('baltazar-ask', {
        detail: prompt,
      })
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 22,
      }}
    >
      {PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => ask(prompt)}
          style={{
            padding: '10px 14px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.12)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

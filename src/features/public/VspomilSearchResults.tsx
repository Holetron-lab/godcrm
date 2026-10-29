export interface SearchResult {
  title: string;
  title_ru: string;
  type: string;
  year: number | string | null;
  author: string;
  description: string;
  confidence: number;
  emoji: string;
}

const TYPE_COLORS: Record<string, string> = {
  movie: '#ef4444',
  book: '#f59e0b',
  song: '#8b5cf6',
  series: '#06b6d4',
  anime: '#ec4899',
  game: '#22c55e',
  comics: '#f97316',
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 2,
          background: color,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{ color: '#666', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', minWidth: 32 }}>
        {pct}%
      </span>
    </div>
  );
}

export function ResultCard({ result, index, onConfirm }: { result: SearchResult; index: number; onConfirm?: () => void }) {
  const typeColor = TYPE_COLORS[result.type] || '#8b5cf6';
  const typeLabels: Record<string, string> = {
    movie: '\u0424\u0438\u043B\u044C\u043C', book: '\u041A\u043D\u0438\u0433\u0430', song: '\u041F\u0435\u0441\u043D\u044F',
    series: '\u0421\u0435\u0440\u0438\u0430\u043B', anime: '\u0410\u043D\u0438\u043C\u0435', game: '\u0418\u0433\u0440\u0430',
    comics: '\u041A\u043E\u043C\u0438\u043A\u0441',
  };

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${typeColor}33`,
      borderRadius: 14,
      padding: '20px',
      animation: `fadeSlideIn 0.4s ease ${index * 0.15}s both`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 28 }}>{result.emoji}</span>
          <div>
            <div style={{ color: '#e0e0e0', fontSize: 17, fontWeight: 700 }}>
              {result.title_ru || result.title}
            </div>
            {result.title_ru && result.title !== result.title_ru && (
              <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{result.title}</div>
            )}
          </div>
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 6,
          background: `${typeColor}22`, color: typeColor,
          fontSize: 11, fontWeight: 600,
        }}>
          {typeLabels[result.type] || result.type}
        </span>
      </div>

      <div style={{ color: '#999', fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
        {result.description}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#555', fontSize: 12 }}>
          {result.author}{result.year ? ` \u00B7 ${result.year}` : ''}
        </div>
        <div style={{ width: 100 }}>
          <ConfidenceBar value={result.confidence} />
        </div>
      </div>

      {onConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          style={{
            marginTop: 14,
            width: '100%',
            padding: '12px 18px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            border: 'none',
            cursor: 'pointer',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            boxShadow: '0 4px 14px rgba(34, 197, 94, 0.3)',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          {'\u0414\u0430, \u044D\u0442\u043E \u043E\u043D\u043E! \uD83C\uDF89'}
        </button>
      )}
    </div>
  );
}

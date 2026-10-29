import { useState, useEffect, useRef } from 'react';
import { ResultCard, type SearchResult } from './VspomilSearchResults';
import { LOADING_MESSAGES, DEMO_EXAMPLES, LUCKY_QUERIES, logEvent, newId } from './vspomilSearchData';

export function AISearch({ onCategoryClick }: { onCategoryClick?: string }) {
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [exIdx, setExIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedResult, setConfirmedResult] = useState<SearchResult | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refineHint, setRefineHint] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const excludedRef = useRef<string[]>([]);
  const lastQueryRef = useRef<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string>('');
  const chainIdRef = useRef<string>('');
  const moreCountRef = useRef<number>(0);
  const reformulatingRef = useRef<boolean>(false);
  const luckyPendingRef = useRef<boolean>(false);
  if (!sessionIdRef.current) sessionIdRef.current = newId();

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('vspomil_history');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(parsed.filter((s: unknown) => typeof s === 'string' && (s as string).trim().length > 0).slice(0, 5));
      }
    } catch { /* Keep the initial empty history if storage is unavailable or contains invalid JSON. */ }
  }, []);

  const pushHistory = (q: string) => {
    setHistory(prev => {
      const next = [q, ...prev.filter(x => x !== q)].slice(0, 5);
      try { localStorage.setItem('vspomil_history', JSON.stringify(next)); } catch { /* Keep search history in memory if browser storage cannot persist it. */ }
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem('vspomil_history'); } catch { /* The visible history is already cleared even when storage removal fails. */ }
  };

  const handleLucky = () => {
    if (loading) return;
    const pool = LUCKY_QUERIES.filter(q => q !== query.trim());
    const list = pool.length > 0 ? pool : LUCKY_QUERIES;
    const pick = list[Math.floor(Math.random() * list.length)];
    setQuery(pick);
    setError('');
    setRefineHint(false);
    luckyPendingRef.current = true;
    logEvent({
      type: 'lucky_click',
      session_id: sessionIdRef.current,
      query: pick,
    });
    inputRef.current?.focus();
  };

  // Rotate humorous loading messages every 3s while loading or loading more
  useEffect(() => {
    if (!loading && !loadingMore) return;
    const t = setInterval(() => {
      setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 3000);
    return () => clearInterval(t);
  }, [loading, loadingMore]);

  // Set query from category click
  useEffect(() => {
    if (onCategoryClick) {
      setQuery(onCategoryClick);
      setResults([]);
      setError('');
      inputRef.current?.focus();
    }
  }, [onCategoryClick]);

  // Typewriter effect for placeholder
  useEffect(() => {
    if (query) return;
    const example = DEMO_EXAMPLES[exIdx];
    if (charIdx <= example.length) {
      const t = setTimeout(() => {
        setPlaceholder(example.slice(0, charIdx));
        setCharIdx(c => c + 1);
      }, 50);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => {
        setCharIdx(0);
        setExIdx((exIdx + 1) % DEMO_EXAMPLES.length);
      }, 6000);
      return () => clearTimeout(t);
    }
  }, [charIdx, exIdx, query]);

  const runSearch = async (q: string, excludeTitles: string[], mode: 'initial' | 'more') => {
    const wasReformulating = reformulatingRef.current;
    const wasLucky = luckyPendingRef.current;
    const prevQuery = lastQueryRef.current;
    if (mode === 'initial') {
      setLoading(true);
      setLoadingMsgIdx(Math.floor(Math.random() * LOADING_MESSAGES.length));
      setResults([]);
      setConfirmed(false);
      setConfirmedResult(null);
      setRefineHint(false);
      excludedRef.current = [];
      moreCountRef.current = 0;
      if (!chainIdRef.current || !wasReformulating) chainIdRef.current = newId();
      reformulatingRef.current = false;
      luckyPendingRef.current = false;
    } else {
      setLoadingMore(true);
      setLoadingMsgIdx(Math.floor(Math.random() * LOADING_MESSAGES.length));
      moreCountRef.current += 1;
      logEvent({
        type: 'more_variants',
        chain_id: chainIdRef.current,
        session_id: sessionIdRef.current,
        query: q,
        more_count: moreCountRef.current,
      });
    }
    setError('');
    lastQueryRef.current = q;

    if (mode === 'initial' && wasReformulating && prevQuery && prevQuery !== q) {
      logEvent({
        type: 'reformulate',
        chain_id: chainIdRef.current,
        session_id: sessionIdRef.current,
        query: q,
        prev_query: prevQuery,
      });
    }

    try {
      const resp = await fetch('/api/v3/tools/vspomnil/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, exclude: excludeTitles }),
      });

      if (resp.status === 429) {
        setError('\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432. \u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u043C\u0438\u043D\u0443\u0442\u0443.');
        return;
      }

      const data = await resp.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      const next: SearchResult[] = data.results || [];
      setResults(next);
      logEvent({
        type: 'search',
        chain_id: chainIdRef.current,
        session_id: sessionIdRef.current,
        query: q,
        mode,
        more_count: mode === 'more' ? moreCountRef.current : undefined,
        is_lucky: wasLucky || undefined,
        results: next.map(r => ({
          title: r.title,
          title_ru: r.title_ru,
          type: r.type,
          confidence: r.confidence,
        })),
      });
      if (next.length) {
        excludedRef.current = [
          ...excludedRef.current,
          ...next.map(r => r.title).filter(Boolean),
        ];
      } else {
        setError(mode === 'more'
          ? '\u0411\u043E\u043B\u044C\u0448\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u043E\u0432 \u043D\u0435 \u043D\u0430\u0448\u043B\u043E\u0441\u044C. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u043E\u043F\u0438\u0441\u0430\u0442\u044C \u0438\u043D\u0430\u0447\u0435.'
          : '\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u043E\u0441\u044C. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043E\u043F\u0438\u0441\u0430\u0442\u044C \u043F\u043E\u0434\u0440\u043E\u0431\u043D\u0435\u0435.');
      }
    } catch {
      setError('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.');
    } finally {
      if (mode === 'initial') setLoading(false);
      else setLoadingMore(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || q.length < 3) return;
    pushHistory(q);
    await runSearch(q, [], 'initial');
  };

  const handleHistoryClick = async (q: string) => {
    setQuery(q);
    setError('');
    setRefineHint(false);
    pushHistory(q);
    await runSearch(q, [], 'initial');
  };

  const handleMoreVariants = async () => {
    const q = lastQueryRef.current;
    if (!q) return;
    await runSearch(q, excludedRef.current, 'more');
  };

  const handleConfirm = (result: SearchResult) => {
    setConfirmed(true);
    setConfirmedResult(result);
    const position = results.findIndex(r => r.title === result.title && r.type === result.type);
    logEvent({
      type: 'confirm',
      chain_id: chainIdRef.current,
      session_id: sessionIdRef.current,
      query: lastQueryRef.current,
      result: {
        title: result.title,
        title_ru: result.title_ru,
        type: result.type,
        confidence: result.confidence,
        position: position >= 0 ? position : undefined,
      },
    });
    chainIdRef.current = '';
    moreCountRef.current = 0;
    reformulatingRef.current = false;
  };

  const handleFindSimilar = async () => {
    if (!confirmedResult) return;
    const title = confirmedResult.title_ru || confirmedResult.title;
    if (!title) return;
    const typePrefix: Record<string, string> = {
      movie: '\u0444\u0438\u043B\u044C\u043C\u044B \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      book: '\u043A\u043D\u0438\u0433\u0438 \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      song: '\u043F\u0435\u0441\u043D\u0438 \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      series: '\u0441\u0435\u0440\u0438\u0430\u043B\u044B \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      anime: '\u0430\u043D\u0438\u043C\u0435 \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      game: '\u0438\u0433\u0440\u044B \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
      comics: '\u043A\u043E\u043C\u0438\u043A\u0441\u044B \u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430',
    };
    const prefix = typePrefix[confirmedResult.type] || '\u043F\u043E\u0445\u043E\u0436\u0438\u0435 \u043D\u0430';
    const q = `${prefix} \u00AB${title}\u00BB`;
    logEvent({
      type: 'find_similar',
      session_id: sessionIdRef.current,
      query: q,
      prev_query: lastQueryRef.current,
    });
    setQuery(q);
    setConfirmed(false);
    setConfirmedResult(null);
    pushHistory(q);
    await runSearch(q, [], 'initial');
  };

  const handleNotFound = () => {
    logEvent({
      type: 'not_found',
      chain_id: chainIdRef.current,
      session_id: sessionIdRef.current,
      query: lastQueryRef.current,
    });
    reformulatingRef.current = true;
    setResults([]);
    setError('');
    setRefineHint(true);
    excludedRef.current = [];
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  };

  const handleRestart = () => {
    if (chainIdRef.current) {
      logEvent({
        type: 'restart',
        chain_id: chainIdRef.current,
        session_id: sessionIdRef.current,
        query: lastQueryRef.current,
      });
    }
    setConfirmed(false);
    setConfirmedResult(null);
    setResults([]);
    setError('');
    setQuery('');
    setRefineHint(false);
    excludedRef.current = [];
    lastQueryRef.current = '';
    chainIdRef.current = '';
    moreCountRef.current = 0;
    reformulatingRef.current = false;
    luckyPendingRef.current = false;
    inputRef.current?.focus();
  };

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(''); setRefineHint(false); }}
          placeholder={query ? '' : placeholder + '|'}
          style={{
            width: '100%',
            padding: '16px 20px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: 14,
            color: '#e0e0e0',
            fontSize: 16,
            outline: 'none',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            boxSizing: 'border-box',
            transition: 'border-color 0.3s',
          }}
          onFocus={e => e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.7)'}
          onBlur={e => e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)'}
        />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              flex: '2 1 220px',
              padding: '14px 24px',
              borderRadius: 12,
              background: loading ? '#444' : 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              border: 'none',
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontSize: 16, fontWeight: 700, color: '#fff',
              boxShadow: loading ? 'none' : '0 6px 20px rgba(139, 92, 246, 0.35)',
              transition: 'all 0.3s',
              letterSpacing: 0.3,
              minHeight: 52,
            }}
          >
            {loading ? (
              <>
                <div style={{
                  width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                <span key={loadingMsgIdx} style={{
                  fontSize: 13,
                  fontWeight: 500,
                  animation: 'loadingMsgFade 1.8s ease',
                  textAlign: 'left',
                  lineHeight: 1.3,
                }}>
                  {LOADING_MESSAGES[loadingMsgIdx]}
                </span>
              </>
            ) : (
              <>
                <span>{'\u2728'}</span>
                <span>{'\u0412\u0441\u043F\u043E\u043C\u043D\u0438\u0442\u044C!'}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleLucky}
            disabled={loading}
            title="Вставит случайный запрос из коллекции примеров. Отредактируй или сразу жми поиск"
            style={{
              flex: '1 1 160px',
              padding: '14px 20px',
              borderRadius: 12,
              background: loading ? '#333' : 'linear-gradient(135deg, #f97316, #ea580c)',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 15, fontWeight: 700, color: '#fff',
              boxShadow: loading ? 'none' : '0 6px 20px rgba(249, 115, 22, 0.35)',
              transition: 'all 0.3s',
              letterSpacing: 0.3,
              minHeight: 52,
              opacity: loading ? 0.5 : 1,
            }}
          >
            <span>{'\uD83C\uDFB2'}</span>
            <span>Мне повезёт (рандом)</span>
          </button>
        </div>
      </form>

      {/* Recent queries history */}
      {history.length > 0 && (
        <div style={{
          marginTop: 16,
          padding: '14px 16px',
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(139, 92, 246, 0.18)',
          borderRadius: 12,
          animation: 'fadeSlideIn 0.3s ease',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <div style={{
              color: '#888',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: 1,
              fontWeight: 600,
            }}>
              {'\uD83D\uDD52 \u041D\u0435\u0434\u0430\u0432\u043D\u0438\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B'}
            </div>
            <button
              type="button"
              onClick={clearHistory}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#666',
                fontSize: 12,
                padding: '2px 6px',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            >
              {'\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {history.map((q, i) => (
              <button
                key={`${i}-${q}`}
                type="button"
                onClick={() => handleHistoryClick(q)}
                disabled={loading}
                title={q}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: 'rgba(139, 92, 246, 0.08)',
                  border: '1px solid rgba(139, 92, 246, 0.25)',
                  cursor: loading ? 'wait' : 'pointer',
                  color: '#c4b5fd',
                  fontSize: 12,
                  fontWeight: 500,
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  if (loading) return;
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.18)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.25)';
                }}
              >
                {q.length > 60 ? q.slice(0, 57) + '\u2026' : q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 10, color: '#f87171', fontSize: 13,
          textAlign: 'center',
          animation: 'fadeIn 0.3s ease',
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && !confirmed && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: '#555', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            {'\uD83C\uDFAF'} {results.length === 1 ? '\u041D\u0430\u0439\u0434\u0435\u043D\u043E' : '\u0412\u0430\u0440\u0438\u0430\u043D\u0442\u044B'}
          </div>
          {results.map((r, i) => (
            <ResultCard key={`${excludedRef.current.length}-${i}`} result={r} index={i} onConfirm={() => handleConfirm(r)} />
          ))}

          {/* Show more variants */}
          <button
            type="button"
            onClick={handleMoreVariants}
            disabled={loadingMore}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '14px 18px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              cursor: loadingMore ? 'wait' : 'pointer',
              color: '#c4b5fd',
              fontSize: 14,
              fontWeight: 600,
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              animation: 'fadeSlideIn 0.4s ease',
              minHeight: 52,
            }}
            onMouseEnter={e => {
              if (loadingMore) return;
              e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
              e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.7)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
            }}
          >
            {loadingMore ? (
              <>
                <div style={{
                  width: 14, height: 14, border: '2px solid rgba(196,181,253,0.3)',
                  borderTopColor: '#c4b5fd', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  flexShrink: 0,
                }} />
                <span key={loadingMsgIdx} style={{
                  fontSize: 13,
                  fontWeight: 500,
                  animation: 'loadingMsgFade 1.8s ease',
                  textAlign: 'left',
                  lineHeight: 1.3,
                }}>
                  {LOADING_MESSAGES[loadingMsgIdx]}
                </span>
              </>
            ) : (
              <span>{'\uD83D\uDD04 \u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0434\u0440\u0443\u0433\u0438\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B'}</span>
            )}
          </button>

          {/* Not found — refine prompt */}
          <button
            type="button"
            onClick={handleNotFound}
            style={{
              marginTop: 2,
              width: '100%',
              padding: '6px 0',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#888',
              fontSize: 13,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              transition: 'color 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c4b5fd')}
            onMouseLeave={e => (e.currentTarget.style.color = '#888')}
          >
            {'\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0442\u043E, \u0447\u0442\u043E \u0438\u0441\u043A\u0430\u043B'}
          </button>
        </div>
      )}

      {/* Refine hint */}
      {refineHint && (
        <div style={{
          marginTop: 20,
          padding: '20px 22px',
          background: 'rgba(139, 92, 246, 0.08)',
          border: '1px solid rgba(139, 92, 246, 0.25)',
          borderRadius: 14,
          animation: 'fadeSlideIn 0.4s ease',
        }}>
          <div style={{ color: '#e0e0e0', fontSize: 15, fontWeight: 600, marginBottom: 10, lineHeight: 1.5 }}>
            {'\u041E\u043F\u0438\u0448\u0438 \u0437\u0430\u043F\u0440\u043E\u0441 \u043F\u043E-\u0434\u0440\u0443\u0433\u043E\u043C\u0443. \u0414\u043E\u0431\u0430\u0432\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u0434\u0435\u0442\u0430\u043B\u0435\u0439: \u0433\u043E\u0434, \u0441\u0442\u0440\u0430\u043D\u0443, \u0438\u043C\u0435\u043D\u0430, \u0441\u044E\u0436\u0435\u0442 \u2014 \u0447\u0435\u043C \u0442\u043E\u0447\u043D\u0435\u0435, \u0442\u0435\u043C \u043B\u0443\u0447\u0448\u0435.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: '#ef4444', fontSize: 14, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{'\u2717'}</span>
              <div style={{ color: '#888', fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
                  {'\u043F\u043B\u043E\u0445\u043E'}
                </span>
                {'\u00AB\u043A\u043D\u0438\u0433\u0430 \u043F\u0440\u043E \u043C\u0430\u043B\u044C\u0447\u0438\u043A\u0430\u00BB'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ color: '#22c55e', fontSize: 14, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{'\u2713'}</span>
              <div style={{ color: '#c4b5fd', fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}>
                  {'\u0445\u043E\u0440\u043E\u0448\u043E'}
                </span>
                {'\u00AB\u043A\u043D\u0438\u0433\u0430 \u043F\u0440\u043E \u043C\u0430\u043B\u044C\u0447\u0438\u043A\u0430-\u0432\u043E\u043B\u0448\u0435\u0431\u043D\u0438\u043A\u0430 \u0441\u043E \u0448\u0440\u0430\u043C\u043E\u043C \u043D\u0430 \u043B\u0431\u0443, \u0436\u0438\u0432\u0451\u0442 \u0443 \u0442\u0451\u0442\u0438, 1997 \u0433\u043E\u0434\u00BB'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation celebration */}
      {confirmed && (
        <div style={{
          marginTop: 24,
          padding: '32px 24px',
          textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(139,92,246,0.12))',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: 18,
          animation: 'fadeSlideIn 0.5s ease',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ fontSize: 56, marginBottom: 12, animation: 'bounce 1s ease infinite' }}>
            {'\uD83C\uDF8A'}
          </div>
          <div style={{
            color: '#fff',
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 10,
            letterSpacing: 0.3,
          }}>
            {'\u0423\u0440\u0430! \u041C\u044B \u0441\u043C\u043E\u0433\u043B\u0438 \u043F\u043E\u043C\u043E\u0447\u044C!'}
          </div>
          <div style={{
            color: '#c4b5fd',
            fontSize: 15,
            marginBottom: 24,
            lineHeight: 1.5,
          }}>
            {'\u0422\u0435\u043F\u0435\u0440\u044C \u0442\u044B \u0432\u0441\u043F\u043E\u043C\u043D\u0438\u043B! \uD83D\uDE0E \u0425\u043E\u0440\u043E\u0448\u0435\u0433\u043E \u0432\u0435\u0447\u0435\u0440\u0430 \u0441 \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u043C.'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {confirmedResult && (
              <button
                type="button"
                onClick={handleFindSimilar}
                style={{
                  padding: '12px 24px',
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
                  transition: 'transform 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                {'\uD83D\uDD0D \u041D\u0430\u0439\u0442\u0438 \u043F\u043E\u0445\u043E\u0436\u0435\u0435'}
              </button>
            )}
            <button
              type="button"
              onClick={handleRestart}
              style={{
                padding: '12px 24px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                cursor: 'pointer',
                color: '#c4b5fd',
                fontSize: 14,
                fontWeight: 600,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.7)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.4)';
              }}
            >
              {'\u2728 \u0412\u0441\u043F\u043E\u043C\u043D\u0438\u0442\u044C \u0447\u0442\u043E-\u0442\u043E \u0435\u0449\u0451'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes loadingMsgFade {
          0% { opacity: 0; transform: translateY(6px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; transform: translateY(0); }
          100% { opacity: 0.3; transform: translateY(-4px); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}

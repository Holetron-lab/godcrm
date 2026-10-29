import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '@/pages/landing/LandingPage';
import copy from '../../../../shared/landing-copy.json';

vi.mock('@/shared/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock('@/components/brand/TorusBrand', () => ({ TorusBrand: () => <div data-testid="torus" /> }));
vi.mock('@/pages/landing/LandingNewsSection', () => ({ LandingNewsSection: () => null }));

describe('LandingPage — GEO pack (docs 254978 §2/§4, 255025 §B)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the five FAQ questions under #faq as collapsed <details> with their answers', () => {
    const faq = document.querySelector('#faq');
    expect(faq).not.toBeNull();
    const cards = Array.from((faq as HTMLElement).querySelectorAll('details'));
    expect(cards.map((d) => d.querySelector('summary h3')?.textContent)).toEqual(
      copy.faq.items.map((i) => i.q),
    );
    for (const card of cards) {
      expect(card.open).toBe(false);
      expect(card.querySelector('summary .cap-card-toggle')).not.toBeNull();
    }
    for (const item of copy.faq.items) {
      expect(within(faq as HTMLElement).getByText(item.a)).toBeInTheDocument();
    }
    // The FAQ list is as wide as the other blocks' containers (owner, chat 3660).
    expect(faq?.querySelector('.max-w-6xl > .max-w-4xl:not(p)')).toBeNull();
  });

  it('places the category anchor as plain text at the end of UNDER THE HOOD', () => {
    const anchor = screen.getByText(copy.underTheHood.anchor);
    expect(anchor.tagName).toBe('P');
    expect(anchor.closest('section')).toContainElement(screen.getByText(copy.underTheHood.title));
  });

  it('prints the model-swap quote with "about ten times" and no team numbers (owner, chat 3772)', () => {
    // Q4 of the FAQ paraphrases the same fact; the verbatim quote names the hosts.
    const story = screen.getByText(/We changed the model about ten times while running a real company on GOD CRM: Claude, Grok/);
    expect(story.textContent).toContain(copy.story.conclusion);
    expect(screen.queryByText(/agents run/)).toBeNull();
  });

  it('grounds "and life" in the kicker: calendar in CONTEXT, fitness module in FAQ Q5', () => {
    expect(screen.getByText(copy.hero.kicker).textContent).toContain('business and life');
    expect(screen.getByText(/Tables, documents, chats, calendar and people/)).toBeInTheDocument();
    expect(screen.getByText(/A fitness module ships with it/)).toBeInTheDocument();
  });

  it('hides the enemy link until Closed Tab #0 and links the MEMORY card to rcll.ai (v3.2, docs 255372/255392)', () => {
    expect(screen.queryByText("SEE WHICH TABS WE'VE CLOSED →")).toBeNull();
    expect(screen.getByRole('link', { name: 'rcll.ai →' })).toHaveAttribute('href', 'https://rcll.ai');
  });

  it('keeps the four inside cards and the honest-status anchor id', () => {
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).slice(0, 4))
      .toEqual(['CONTEXT', 'RIGHTS', 'MEMORY', 'BUILD']);
    expect(document.querySelector('#whats-broken')).not.toBeNull();
  });
});

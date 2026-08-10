import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { useAuthStore } from '@/features/auth/store/authStore';

const RegisterPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, initialized } = useAuthStore((state) => ({
    user: state.user,
    initialized: state.initialized
  }));

  useEffect(() => {
    if (!initialized || !user) return;
    const redirectState = location.state as { from?: string } | null;
    const target =
      redirectState?.from && typeof redirectState.from === 'string' ? redirectState.from : '/spaces';
    navigate(target, { replace: true });
  }, [initialized, user, navigate, location.state]);

  return (
    <main className="brutal-root relative min-h-screen overflow-x-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <style>{`
        .brutal-edge { border-color: var(--text-primary); }
        .brutal-shadow {
          transition: transform 150ms ease-out, box-shadow 150ms ease-out;
        }
        .brutal-shadow:hover {
          box-shadow: 6px 6px 0 var(--text-primary);
          transform: translate(-2px, -2px);
        }
        .brutal-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(var(--text-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--text-primary) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.05;
        }
        @media (prefers-reduced-motion: reduce) {
          .brutal-shadow { transition: none; }
          .brutal-shadow:hover { box-shadow: none; transform: none; }
        }
      `}</style>

      <header className="brutal-edge sticky top-0 z-40 flex h-14 items-center justify-between border-b-2 bg-[var(--bg-primary)] px-4 md:px-6">
        <Link
          to="/welcome"
          className="flex items-center gap-2 font-mono text-sm font-black uppercase tracking-widest"
        >
          <span>GOD CRM</span>
        </Link>
        <Link
          to="/auth/login"
          className="brutal-edge brutal-shadow border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest"
        >
          SIGN IN
        </Link>
      </header>

      <section className="relative flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-6 py-10 md:py-20">
        <div className="brutal-grid" aria-hidden />
        <div className="relative w-full max-w-md">
          <h1 className="text-4xl font-black lowercase tracking-tighter md:text-5xl">drop in.</h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)] md:text-sm">
            godcrm alpha. free. no card required.
          </p>

          <div className="mt-8">
            <RegisterForm />
          </div>

          <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-[var(--text-secondary)]">
            already have an account? →{' '}
            <Link to="/auth/login" className="underline hover:text-[var(--text-primary)]">
              sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
};

export default RegisterPage;

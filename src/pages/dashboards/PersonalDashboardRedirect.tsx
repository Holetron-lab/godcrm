import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';

/**
 * Redirect component that finds user's personal space and redirects to its dashboard
 */
export function PersonalDashboardRedirect() {
  const navigate = useNavigate();
  const { data: spaces, isLoading } = useSpacesQuery();

  useEffect(() => {
    if (isLoading || !spaces) return;

    // Find personal space
    const personalSpace = spaces.find(s => s.type === 'personal');
    
    if (personalSpace) {
      // Redirect to personal space dashboard
      navigate(`/spaces/${personalSpace.id}/dashboard`, { replace: true });
    } else if (spaces.length > 0) {
      // Fallback to first available space
      navigate(`/spaces/${spaces[0].id}/dashboard`, { replace: true });
    } else {
      // No spaces - redirect to spaces page to create one
      navigate('/spaces', { replace: true });
    }
  }, [spaces, isLoading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
      <p className="text-base text-[var(--text-secondary)]">Redirecting to dashboard...</p>
    </div>
  );
}

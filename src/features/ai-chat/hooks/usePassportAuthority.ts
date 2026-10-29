import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import { apiClient } from '@/shared/utils/apiClient';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const reasonKeys = {
  ok: '',
  not_authenticated: 'aiChat.ui.passportAuthoritySignIn',
  agent_principal: 'aiChat.ui.passportAuthorityHuman',
  residence_not_found: 'aiChat.ui.passportAuthorityResidence',
  global_role_required: 'aiChat.ui.passportAuthorityGlobalRole',
  space_admin_required: 'aiChat.ui.passportAuthoritySpaceAdmin',
} as const;

type PassportAuthority = {
  allowed: boolean;
  reason: keyof typeof reasonKeys;
  space: { id: number | null };
};

export function usePassportAuthority(target: 'row_id' | 'space_id', id: number | null, enabled = true) {
  const { t } = useLanguage();
  const actorId = useAuthStore(state => state.user?.id);
  const query = useQuery({
    queryKey: ['passport-authority', actorId, target, id],
    enabled: enabled && Number.isInteger(id) && Number(id) > 0,
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data?: PassportAuthority }>(
        `/users/passport-authority?${target}=${id}`,
      );
      const data = response.data;
      if (!response.success || !data || typeof data.allowed !== 'boolean' ||
          !Object.prototype.hasOwnProperty.call(reasonKeys, data.reason) ||
          (data.allowed && (data.reason !== 'ok' || !data.space?.id))) {
        throw new Error(t('aiChat.ui.passportAuthorityFailed'));
      }
      return data;
    },
    retry: false,
  });
  const allowed = enabled && query.isSuccess && !query.isFetching && query.data.allowed === true;
  const hint = query.isError ? t('aiChat.ui.passportAuthorityFailed')
    : query.isPending || query.isFetching ? t('aiChat.ui.passportAuthorityChecking')
    : !query.data.allowed ? t(reasonKeys[query.data.reason] || 'aiChat.ui.passportAuthorityFailed') : '';
  return { ...query, allowed, hint };
}

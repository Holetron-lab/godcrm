import { useEffect, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, Camera, Loader2, Check, AlertTriangle, X, Trash2, Gift, Copy, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { authApi, UserProfile } from '@/features/auth/api/authApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button, Input } from '@/shared/components/ui';
import { showToast } from '@/shared/hooks/useToast';

// Max file size: 5MB (matches backend limit)
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Accepted file types
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Get the display URL for an avatar value.
 * Handles both old base64 avatars and new URL-based avatars.
 */
const getAvatarSrc = (avatar: string | null | undefined): string | null => {
  if (!avatar) return null;
  // Old base64 format: data:image/...
  if (avatar.startsWith('data:')) return avatar;
  // New URL format: /uploads/avatars/...
  if (avatar.startsWith('/uploads/')) return avatar;
  // Absolute URL (edge case)
  if (avatar.startsWith('http')) return avatar;
  return avatar;
};

export const ProfileSettings = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [colorDraft, setColorDraft] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await authApi.getProfile();
      if (res.success) {
        setName(res.data.name);
        return res.data;
      }
      throw new Error('Failed to load profile');
    }
  });

  // ADR-183-A D3 — scannable QR of the invite link. Client-side via the existing
  // `qrcode` dep (no server round-trip); regenerates whenever the code changes,
  // so self-service regeneration swaps the QR in step with the link.
  useEffect(() => {
    const code = profileData?.referral_code;
    if (!code) {
      setQrDataUrl(null);
      return;
    }
    const link = `${window.location.origin}/auth/register?ref=${encodeURIComponent(code)}`;
    let alive = true;
    QRCode.toDataURL(link, { margin: 1, width: 256, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (alive) setQrDataUrl(url); })
      .catch(() => { if (alive) setQrDataUrl(null); });
    return () => { alive = false; };
  }, [profileData?.referral_code]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: { name?: string }) => authApi.updateProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsEditing(false);
    }
  });

  const saveColor = useMutation({
    mutationFn: async (color: string) => {
      const result = await authApi.updateProfile({ color });
      if (!result.success || result.data.color !== color) throw new Error(t('aiChat.ui.couldNotSave'));
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      await queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['chat-all-users'] });
      setColorDraft(null);
    },
  });

  // ADR-099: Upload avatar as file (FormData)
  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setUploadError(null);
    },
    onError: (error: Error) => {
      setUploadError(error.message || 'Failed to upload avatar');
    }
  });

  // ADR-099: Delete avatar
  const deleteAvatarMutation = useMutation({
    mutationFn: () => authApi.deleteAvatar(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setUploadError(null);
    }
  });

  // ADR-183-A D3 — regenerate the user's referral code (backend rerolls suffix only).
  const regenerateReferralMutation = useMutation({
    mutationFn: () => authApi.regenerateReferralCode(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      // D5 — regeneration invalidates previously-shared ?ref= links.
      showToast(t('settings.profile.referralRegenWarning'), 'info');
      showToast(t('settings.profile.referralRegenSuccess'), 'success');
    },
    onError: () => {
      showToast(t('settings.profile.referralRegenError'), 'error');
    }
  });

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Client-side validation: file type
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.endsWith('.svg')) {
      setUploadError('Unsupported file type. Use PNG, JPG, GIF, WebP, or SVG.');
      return;
    }

    // Client-side validation: file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_FILE_SIZE_MB}MB)`);
      return;
    }

    // Upload via new File API
    uploadAvatarMutation.mutate(file);

    // Reset file input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteAvatar = () => {
    deleteAvatarMutation.mutate();
  };

  const handleSaveName = () => {
    if (name.trim() && name !== profileData?.name) {
      updateProfileMutation.mutate({ name: name.trim() });
    } else {
      setIsEditing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const profile = profileData as UserProfile;
  const avatarSrc = getAvatarSrc(profile?.avatar);
  const isUploading = uploadAvatarMutation.isPending || deleteAvatarMutation.isPending;

  // ADR-183-A D3 — referral code + shareable invite link.
  const referralCode = profile?.referral_code || '';
  const inviteLink = referralCode
    ? `${window.location.origin}/auth/register?ref=${encodeURIComponent(referralCode)}`
    : '';

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast(t('settings.profile.referralCopied'), 'success');
    } catch {
      showToast(t('settings.profile.referralCopyError'), 'error');
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('settings.profile.title') || 'Profile'}
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('settings.profile.subtitle') || 'Manage your profile settings'}
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Left column - Avatar */}
        <div className="flex flex-col items-center p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <button
            type="button"
            aria-label={t('settings.profile.changeAvatar')}
            disabled={isUploading}
            className="relative cursor-pointer group mb-4 rounded-full focus-visible:ring-2"
            onClick={handleAvatarClick}
          >
            <div className="h-24 w-24 rounded-full overflow-hidden bg-[var(--bg-secondary)] border-3 border-[var(--border-primary)] flex items-center justify-center shadow-lg">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={profile.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="h-12 w-12 text-[var(--text-secondary)]" />
              )}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="h-6 w-6 text-white" />
            </div>
            {isUploading && (
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              </div>
            )}
          </button>

          <p className="font-semibold text-[var(--text-primary)] text-center">{profile?.name}</p>
          <p className="text-sm text-[var(--text-secondary)] text-center">{profile?.email}</p>

          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAvatarClick}
              disabled={isUploading}
              className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1 disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" />
              {t('settings.profile.changeAvatar') || 'Change avatar'}
            </button>
            {avatarSrc && (
              <button
                onClick={handleDeleteAvatar}
                disabled={isUploading}
                className="text-sm text-red-500 hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('settings.profile.removeAvatar') || 'Remove'}
              </button>
            )}
          </div>

          <fieldset disabled={saveColor.isPending} className="flex items-center gap-3 mt-4">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              {t('settings.profile.shadowColor')}
              <input type="color" value={colorDraft ?? profile?.color ?? '#3b82f6'} onChange={e => setColorDraft(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--border-primary)] bg-transparent" />
            </label>
            <Button size="sm" loading={saveColor.isPending} disabled={colorDraft === null || colorDraft === profile?.color} onClick={() => colorDraft && saveColor.mutate(colorDraft)}>{t('aiChat.ui.save')}</Button>
          </fieldset>
          <div className="mt-3 w-full rounded-lg bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]" style={{ boxShadow: `inset -4px 0 0 0 ${colorDraft ?? profile?.color ?? '#3b82f6'}` }}>
            {t('settings.profile.shadowPreview')}
          </div>
          {saveColor.isError && <p role="alert" className="mt-2 text-xs text-red-500">{saveColor.error.message}</p>}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Upload error */}
          {uploadError ? (
            <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-red-500">{uploadError}</p>
                <button
                  onClick={() => setUploadError(null)}
                  className="text-xs text-red-400 hover:underline mt-1"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[10px] text-[var(--text-secondary)] text-center max-w-[200px]">
              PNG, JPG, GIF, WebP, SVG. Max 5MB.
            </p>
          )}
        </div>

        {/* Right column - Profile info */}
        <div className="space-y-4">
          {/* Name */}
          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
            <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              {t('settings.profile.name') || 'Name'}
            </label>
            {isEditing ? (
              <div className="flex gap-2 mt-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleSaveName}
                  disabled={updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setIsEditing(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[var(--text-primary)] font-medium">{profile?.name}</span>
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-xs text-[var(--color-primary)] hover:underline"
                >
                  {t('common.edit') || 'Edit'}
                </button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
            <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              {t('settings.profile.email') || 'Email'}
            </label>
            <p className="text-[var(--text-primary)] font-medium mt-1">{profile?.email}</p>
          </div>

          {/* Member since */}
          <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
            <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              {t('settings.profile.memberSince') || 'Member since'}
            </label>
            <p className="text-[var(--text-primary)] font-medium mt-1">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              }) : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* ADR-183-A D3 — referral code + shareable invite link + regenerate */}
      <div className="mt-6 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
        <div className="flex items-center gap-2 mb-1">
          <Gift className="h-4 w-4 text-[var(--color-primary)]" />
          <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            {t('settings.profile.referralTitle')}
          </label>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mb-3">
          {t('settings.profile.referralSubtitle')}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="flex-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-secondary)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] break-all">
            {referralCode || '—'}
          </code>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={handleCopyInvite} disabled={!inviteLink}>
              <Copy className="h-4 w-4 mr-1" />
              {t('settings.profile.referralCopyLink')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => regenerateReferralMutation.mutate()}
              disabled={regenerateReferralMutation.isPending}
            >
              {regenerateReferralMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              {t('settings.profile.referralRegenerate')}
            </Button>
          </div>
        </div>

        {inviteLink && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="rounded-xl border border-[var(--border-secondary)] bg-white p-3 shadow-sm">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t('settings.profile.referralQrHint')}
                  width={144}
                  height={144}
                  className="h-36 w-36"
                />
              ) : (
                <div className="flex h-36 w-36 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
                </div>
              )}
            </div>
            <p className="max-w-[10rem] text-center text-xs text-[var(--text-secondary)]">
              {t('settings.profile.referralQrHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

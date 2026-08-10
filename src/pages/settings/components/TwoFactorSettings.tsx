import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Loader2, Check, AlertCircle, Copy, CheckCircle } from 'lucide-react';
import { authApi } from '@/features/auth/api/authApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button, Input } from '@/shared/components/ui';

export const TwoFactorSettings = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [showSetup, setShowSetup] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [error, setError] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  
  // Disable 2FA state
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await authApi.getProfile();
      if (res.success) return res.data;
      throw new Error('Failed to load profile');
    }
  });

  const setup2FAMutation = useMutation({
    mutationFn: () => authApi.setup2FA(),
    onSuccess: (res) => {
      if (res.success) {
        setSetupData(res.data);
        setShowSetup(true);
        setError('');
      }
    },
    onError: (error: Error) => {
      setError(error.message || 'Failed to setup 2FA');
    }
  });

  const verify2FAMutation = useMutation({
    mutationFn: (code: string) => authApi.verify2FA(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setShowSetup(false);
      setSetupData(null);
      setVerificationCode('');
      setError('');
    },
    onError: (error: Error) => {
      setError(error.message || 'Invalid code');
    }
  });

  const disable2FAMutation = useMutation({
    mutationFn: (data: { password: string; code?: string }) => authApi.disable2FA(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setShowDisable(false);
      setDisablePassword('');
      setDisableCode('');
      setError('');
    },
    onError: (error: Error) => {
      setError(error.message || 'Failed to disable 2FA');
    }
  });

  const handleCopySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    }
  };

  const handleVerify = () => {
    if (verificationCode.length !== 6) {
      setError(t('settings.2fa.invalidCodeLength') || 'Code must be 6 digits');
      return;
    }
    verify2FAMutation.mutate(verificationCode);
  };

  const handleDisable = () => {
    if (!disablePassword) {
      setError(t('settings.2fa.passwordRequired') || 'Password is required');
      return;
    }
    disable2FAMutation.mutate({ password: disablePassword, code: disableCode || undefined });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const is2FAEnabled = profileData?.totp_enabled;

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('settings.2fa.title') || 'Two-Factor Authentication'}
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('settings.2fa.subtitle') || 'Add an extra layer of security to your account'}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Current status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${is2FAEnabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-[var(--bg-tertiary)]'}`}>
            <Shield className={`h-5 w-5 ${is2FAEnabled ? 'text-green-600' : 'text-[var(--text-secondary)]'}`} />
          </div>
          <div>
            <p className="font-medium text-[var(--text-primary)]">
              {t('settings.2fa.authenticatorApp') || 'Authenticator App'}
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              {is2FAEnabled 
                ? (t('settings.2fa.enabled') || '✓ Enabled')
                : (t('settings.2fa.notEnabled') || 'Not enabled')
              }
            </p>
          </div>
        </div>
        
        {!showSetup && !showDisable && (
          is2FAEnabled ? (
            <Button variant="danger" onClick={() => setShowDisable(true)}>
              {t('settings.2fa.disable') || 'Disable'}
            </Button>
          ) : (
            <Button onClick={() => setup2FAMutation.mutate()}>
              {setup2FAMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t('settings.2fa.enable') || 'Enable'}
            </Button>
          )
        )}
      </div>

      {/* Setup flow */}
      {showSetup && setupData && (
        <div className="space-y-6 border-t border-[var(--border-primary)] pt-6">
          <div className="space-y-4">
            <h4 className="font-medium text-[var(--text-primary)]">
              {t('settings.2fa.setupTitle') || 'Setup Two-Factor Authentication'}
            </h4>
            
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.2fa.step1') || '1. Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)'}
              </p>
              <div className="flex justify-center p-4 bg-white rounded-lg w-fit mx-auto">
                <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.2fa.step2') || "2. Or manually enter this secret key:"}
              </p>
              <div className="flex items-center gap-2 bg-[var(--bg-tertiary)] p-3 rounded-lg max-w-md">
                <code className="text-sm font-mono text-[var(--text-primary)] flex-1 break-all">
                  {setupData.secret}
                </code>
                <button 
                  onClick={handleCopySecret}
                  className="p-2 hover:bg-[var(--bg-secondary)] rounded transition-colors"
                >
                  {secretCopied ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4 text-[var(--text-secondary)]" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.2fa.step3') || '3. Enter the 6-digit code from your app to verify:'}
              </p>
              <Input
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="max-w-xs text-center text-xl tracking-widest font-mono"
                maxLength={6}
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleVerify}
                disabled={verify2FAMutation.isPending || verificationCode.length !== 6}
              >
                {verify2FAMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('settings.2fa.verify') || 'Verify & Enable'}
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowSetup(false);
                  setSetupData(null);
                  setVerificationCode('');
                  setError('');
                }}
              >
                {t('common.cancel') || 'Cancel'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Disable flow */}
      {showDisable && (
        <div className="space-y-4 border-t border-[var(--border-primary)] pt-6">
          <h4 className="font-medium text-[var(--text-primary)]">
            {t('settings.2fa.disableTitle') || 'Disable Two-Factor Authentication'}
          </h4>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('settings.2fa.disableWarning') || 'This will make your account less secure. Enter your password to confirm.'}
          </p>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.2fa.password') || 'Password'}
              </label>
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="••••••••"
                className="max-w-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.2fa.codeOptional') || '2FA Code (optional)'}
              </label>
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="max-w-xs"
                maxLength={6}
              />
            </div>

            <div className="flex gap-2">
              <Button 
                variant="danger"
                onClick={handleDisable}
                disabled={disable2FAMutation.isPending || !disablePassword}
              >
                {disable2FAMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t('settings.2fa.confirmDisable') || 'Disable 2FA'}
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowDisable(false);
                  setDisablePassword('');
                  setDisableCode('');
                  setError('');
                }}
              >
                {t('common.cancel') || 'Cancel'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

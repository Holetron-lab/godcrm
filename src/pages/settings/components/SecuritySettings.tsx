import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, Loader2, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { authApi } from '@/features/auth/api/authApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button, Input } from '@/shared/components/ui';

export const SecuritySettings = () => {
  const { t } = useLanguage();
  
  // Password change state
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Email change state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) => 
      authApi.changePassword(data),
    onSuccess: () => {
      setPasswordSuccess(true);
      setPasswordError('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordForm(false);
        setPasswordSuccess(false);
      }, 2000);
    },
    onError: (error: Error & { message?: string }) => {
      setPasswordError(error.message || 'Failed to change password');
      setPasswordSuccess(false);
    }
  });

  const changeEmailMutation = useMutation({
    mutationFn: (data: { newEmail: string; password: string }) => 
      authApi.changeEmail(data),
    onSuccess: () => {
      setEmailSuccess(true);
      setEmailError('');
      setNewEmail('');
      setEmailPassword('');
      setTimeout(() => {
        setShowEmailForm(false);
        setEmailSuccess(false);
      }, 2000);
    },
    onError: (error: Error & { message?: string }) => {
      setEmailError(error.message || 'Failed to change email');
      setEmailSuccess(false);
    }
  });

  const handleChangePassword = () => {
    setPasswordError('');
    
    if (newPassword.length < 8) {
      setPasswordError(t('settings.security.passwordTooShort') || 'Password must be at least 8 characters');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings.security.passwordsDoNotMatch') || 'Passwords do not match');
      return;
    }
    
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  const handleChangeEmail = () => {
    setEmailError('');
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      setEmailError(t('settings.security.invalidEmail') || 'Invalid email format');
      return;
    }
    
    changeEmailMutation.mutate({ newEmail, password: emailPassword });
  };

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('settings.security.title') || 'Security'}
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('settings.security.subtitle') || 'Manage your account security'}
        </p>
      </div>

      {/* Change Password */}
      <div className="space-y-3 border-b border-[var(--border-primary)] pb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
              <Lock className="h-5 w-5 text-[var(--text-secondary)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)]">
                {t('settings.security.password') || 'Password'}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.security.passwordDescription') || 'Change your password'}
              </p>
            </div>
          </div>
          {!showPasswordForm && (
            <Button variant="secondary" onClick={() => setShowPasswordForm(true)}>
              {t('settings.security.change') || 'Change'}
            </Button>
          )}
        </div>

        {showPasswordForm && (
          <div className="space-y-4 mt-4 pl-13">
            {passwordSuccess && (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                <Check className="h-4 w-4" />
                <span>{t('settings.security.passwordChanged') || 'Password changed successfully'}</span>
              </div>
            )}
            
            {passwordError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>{passwordError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.security.currentPassword') || 'Current Password'}
              </label>
              <div className="relative max-w-sm">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.security.newPassword') || 'New Password'}
              </label>
              <div className="relative max-w-sm">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.security.confirmPassword') || 'Confirm New Password'}
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="max-w-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}
              >
                {changePasswordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t('settings.security.savePassword') || 'Save Password'}
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordError('');
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
              >
                {t('common.cancel') || 'Cancel'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Change Email */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
              <span className="text-lg">📧</span>
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)]">
                {t('settings.security.email') || 'Email Address'}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {t('settings.security.emailDescription') || 'Change your email address'}
              </p>
            </div>
          </div>
          {!showEmailForm && (
            <Button variant="secondary" onClick={() => setShowEmailForm(true)}>
              {t('settings.security.change') || 'Change'}
            </Button>
          )}
        </div>

        {showEmailForm && (
          <div className="space-y-4 mt-4 pl-13">
            {emailSuccess && (
              <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 p-3 rounded-lg">
                <Check className="h-4 w-4" />
                <span>{t('settings.security.emailChanged') || 'Email changed successfully'}</span>
              </div>
            )}
            
            {emailError && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>{emailError}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.security.newEmail') || 'New Email'}
              </label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@email.com"
                className="max-w-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                {t('settings.security.confirmWithPassword') || 'Confirm with Password'}
              </label>
              <Input
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="••••••••"
                className="max-w-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button 
                onClick={handleChangeEmail}
                disabled={changeEmailMutation.isPending || !newEmail || !emailPassword}
              >
                {changeEmailMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t('settings.security.saveEmail') || 'Save Email'}
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowEmailForm(false);
                  setEmailError('');
                  setNewEmail('');
                  setEmailPassword('');
                }}
              >
                {t('common.cancel') || 'Cancel'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

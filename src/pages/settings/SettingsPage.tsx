import { useLanguage } from '@/shared/i18n/LanguageContext';
import { SMTPConfigurator } from '@/features/system/components/SMTPConfigurator';
import { GoogleAuthSettings } from '@/features/system/components/GoogleAuthSettings';
import { BackupSettings } from '@/features/system/components/BackupSettings';
import { DBMonitoring } from '@/features/system/components/DBMonitoring';
import { Button, LanguageSwitcher } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useNavigate } from 'react-router-dom';
import { ProfileSettings } from './components/ProfileSettings';
import { SecuritySettings } from './components/SecuritySettings';
import { TwoFactorSettings } from './components/TwoFactorSettings';
import { RateLimitSettings } from './components/RateLimitSettings';
import { CallsSettings } from './components/CallsSettings';
import { PromoSettings } from './components/PromoSettings';
import { PrimaryColorPicker } from './components/PrimaryColorPicker';
import { ApiSettings } from './components/ApiSettings';
import { AddAgentSettings } from './components/AddAgentSettings';
import { RegistrationPolicySettings } from '@/features/registration/components/RegistrationPolicySettings';
import { useEffect } from 'react';
import { setPageTitle } from '@/shared/utils/pageTitle';
import { Settings, Server, Shield, Palette, Sun, Moon, Monitor, ChevronDown, Crown, PanelLeft, PanelLeftClose } from 'lucide-react';
import { useTheme } from '@/shared/hooks/useTheme';
import { useHeaderLanguageSwitcher } from '@/shared/hooks/useHeaderLanguageSwitcher';
import { useSidebarDefault } from '@/shared/hooks/useSidebarDefault';

const SettingsPage = () => {
  const { t } = useLanguage();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const { defaultTheme, setDefaultTheme } = useTheme();
  const [showHeaderLanguageSwitcher, setShowHeaderLanguageSwitcher] = useHeaderLanguageSwitcher();
  const [sidebarDefault, setSidebarDefault] = useSidebarDefault();

  const isAdminOrOwner = user?.role === 'admin' || user?.role === 'owner';
  const isOwner = user?.role === 'owner';
  
  useEffect(() => {
    setPageTitle('Settings');
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/auth/login');
  };
  
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Settings className="w-7 h-7 text-primary-500" />
            {t('settings.title')}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('settings.subtitle')}
          </p>
        </div>
        <Button variant="secondary" onClick={handleLogout}>
          {t('settings.logout')}
        </Button>
      </div>

      {/* Profile Section */}
      <ProfileSettings />

      {/* API Settings (Desktop App only) */}
      <ApiSettings />

      {/* Security Section (Password & Email) */}
      <SecuritySettings />

      {/* 2FA Section */}
      <TwoFactorSettings />

      {/* ADR-0079 §2: Add Agent — unlocks Tier-B coding pack on demand */}
      <AddAgentSettings />

      {/* ADR-188 Block F — referral surface now lives inside ProfileSettings
          (code + link + scannable QR, sourced from /auth/profile). */}

      {/* Language & Preferences */}
      <div className="space-y-4 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Palette className="h-5 w-5 text-[var(--color-primary-500)]" />
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{t('settings.crmTitle')}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{t('settings.crmSubtitle')}</p>
          </div>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2">
          {/* Row 1: Language + Default Theme */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{t('settings.languageLabel')}</p>
            <LanguageSwitcher />
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={showHeaderLanguageSwitcher}
                onChange={(e) => setShowHeaderLanguageSwitcher(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
              />
              {t('settings.showLanguageSwitcherInHeader')}
            </label>
          </div>
          
          {/* Default Theme */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{t('settingsPage.defaultTheme')}</p>
            <div className="relative">
              <select
                value={defaultTheme}
                onChange={(e) => setDefaultTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 pr-14 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
              >
                <option value="system">🖥️ {t('settingsPage.themeSystem')}</option>
                <option value="light">☀️ {t('settingsPage.themeLight')}</option>
                <option value="dark">🌙 {t('settingsPage.themeDark')}</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 gap-1">
                {defaultTheme === 'system' ? (
                  <Monitor className="h-4 w-4 text-[var(--text-tertiary)]" />
                ) : defaultTheme === 'light' ? (
                  <Sun className="h-4 w-4 text-amber-500" />
                ) : (
                  <Moon className="h-4 w-4 text-primary-500" />
                )}
                <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              {t('settingsPage.appliesOnNewDevice')}
            </p>
          </div>
          
          {/* Default sidebar (menu) visibility */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{t('settingsPage.defaultMenu')}</p>
            <div className="relative">
              <select
                value={sidebarDefault}
                onChange={(e) => setSidebarDefault(e.target.value as 'show' | 'hide')}
                className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 pr-14 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
              >
                <option value="show">📂 {t('settingsPage.menuShow')}</option>
                <option value="hide">📁 {t('settingsPage.menuHide')}</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 gap-1">
                {sidebarDefault === 'show' ? (
                  <PanelLeft className="h-4 w-4 text-primary-500" />
                ) : (
                  <PanelLeftClose className="h-4 w-4 text-[var(--text-tertiary)]" />
                )}
                <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
              </div>
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              {t('settingsPage.appliesOnNewDevice')}
            </p>
          </div>

          {/* Row 2: Primary Color (full width) */}
          <div className="md:col-span-2">
            <PrimaryColorPicker />
          </div>
        </div>
      </div>
      
      {/* Admin section — visible to admin and owner */}
      {isAdminOrOwner && (
        <>
          <div className="relative pt-2">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-[var(--border-primary)]"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 py-1 bg-[var(--bg-primary)] text-sm font-medium text-[var(--text-tertiary)] flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-500" />
                {t('settings.adminSection') || 'Admin settings'}
              </span>
            </div>
          </div>
          <BackupSettings />
          <DBMonitoring />
        </>
      )}

      {/* Owner section — visible to owner only */}
      {isOwner && (
        <>
          <div className="relative pt-2">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-[var(--border-primary)]"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 py-1 bg-[var(--bg-primary)] text-sm font-medium text-[var(--text-tertiary)] flex items-center gap-2">
                <Crown className="w-4 h-4 text-primary-500" />
                {t('settings.ownerSection') || 'Owner settings'}
              </span>
            </div>
          </div>
          <CallsSettings />
          <PromoSettings />
          <SMTPConfigurator />
          <GoogleAuthSettings />
          <RateLimitSettings />
          {/* ADR-188 Block F1/F3 — runtime registration policy + auto-join mapping */}
          <RegistrationPolicySettings />
        </>
      )}
    </div>
  );
};

export default SettingsPage;

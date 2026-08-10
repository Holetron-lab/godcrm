import { HelpPage as HelpPageRu } from './HelpPage';
import { HelpPageEn } from './HelpPageEn';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function HelpPage() {
  const { language } = useLanguage();
  
  if (language === 'en') {
    return <HelpPageEn />;
  }
  
  return <HelpPageRu />;
}

export default HelpPage;

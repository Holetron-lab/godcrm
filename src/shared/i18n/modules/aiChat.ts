import { aiChatEN } from './aiChat.en';
import { aiChatRU } from './aiChat.ru';

export const aiChat = {
  en: {
    ui: aiChatEN,
    contacts: {
      favoritesTitle: 'Favorites',
      filterAll: 'All',
      filterHumans: 'People',
      showSpaceOnly: 'Show space members only',
      showAll: 'Show all users',
      scopeAll: 'All',
      scopeSpace: 'Space',
      searchPlaceholder: 'Search contacts...',
      notFound: 'Not found',
      empty: 'No contacts',
    },
  },
  ru: {
    ui: aiChatRU,
    contacts: {
      favoritesTitle: 'Избранные',
      filterAll: 'Все',
      filterHumans: 'Люди',
      showSpaceOnly: 'Показать только участников спейса',
      showAll: 'Показать всех пользователей',
      scopeAll: 'Все',
      scopeSpace: 'Спейс',
      searchPlaceholder: 'Поиск контактов...',
      notFound: 'Не найдено',
      empty: 'Нет контактов',
    },
  },
} as const;

// backend/routes/v3/telegram/shared.js
// Shared utilities, constants, and imports for Telegram bot modules

import { apiLogger } from '../../../utils/logger.js';
import { sendMessage, sendToTopic, parseAgentCommand, getFileUrl, sendChannelPost, sendChannelPhoto, getChannelMemberCount } from '../../../services/TelegramService.js';
import { dbRun, dbGet, dbAll, isPostgres, safeJsonParse } from '../../../database/connection.js';
import ChainHandoffService from '../../../services/ChainHandoffService.js';

// ===== FORTUNE WHEEL — BREAK ACTIVITIES =====
// Hardcoded list of break activities for the Fortune Wheel.
// Each has emoji, name, duration (min), and description.
// In the future this can be moved to a break_activities DB table.
const BREAK_ACTIVITIES = [
  { emoji: '🧘', name: 'Медитация', duration: 5, description: 'Закрой глаза, сфокусируйся на дыхании. Вдох 4 сек — задержка 4 сек — выдох 6 сек.' },
  { emoji: '🚶', name: 'Прогулка', duration: 10, description: 'Выйди на свежий воздух и пройдись. Не бери телефон!' },
  { emoji: '💪', name: 'Отжимания', duration: 3, description: 'Сделай 3 подхода отжиманий. Между подходами — 30 сек отдыха.' },
  { emoji: '☕', name: 'Чай/Кофе пауза', duration: 7, description: 'Завари чай или кофе. Пей медленно, наслаждаясь вкусом.' },
  { emoji: '👀', name: 'Гимнастика для глаз', duration: 3, description: 'Посмотри вдаль 20 сек, потом на близкий предмет 20 сек. Повтори 5 раз. Поморгай.' },
  { emoji: '🎵', name: 'Музыкальная пауза', duration: 5, description: 'Включи любимый трек и просто послушай. Можно потанцевать!' },
  { emoji: '🧊', name: 'Холодное умывание', duration: 2, description: 'Умойся холодной водой. Бодрит и перезагружает мозг.' },
  { emoji: '📖', name: 'Чтение', duration: 10, description: 'Почитай что-нибудь не по работе. Книга, статья, комикс — что угодно.' },
  { emoji: '🤸', name: 'Растяжка', duration: 5, description: 'Потянись, разомни шею, плечи, спину. Наклоны, повороты.' },
  { emoji: '🎨', name: 'Дудлинг', duration: 5, description: 'Возьми ручку и рисуй что попало. Узоры, каракули, лица — не думай.' },
  { emoji: '💧', name: 'Водный перерыв', duration: 2, description: 'Выпей стакан воды. Медленно, маленькими глотками.' },
  { emoji: '🌬️', name: 'Дыхательная практика', duration: 4, description: 'Техника 4-7-8: вдох 4 сек, задержка 7 сек, выдох 8 сек. 4 цикла.' },
  { emoji: '🐾', name: 'Погладь кота/собаку', duration: 5, description: 'Если рядом есть питомец — удели ему внимание. Нет питомца? Посмотри смешные видео с животными.' },
  { emoji: '🧹', name: 'Мини-уборка', duration: 5, description: 'Протри стол, разложи вещи, выброси мусор. Чистое пространство = чистый ум.' },
  { emoji: '🎮', name: 'Мини-игра', duration: 5, description: 'Сыграй в быструю мобильную игру или головоломку. Только 5 минут!' },
];

/**
 * Select a random break activity and format a Fortune Wheel message.
 * @returns {{ activity: Object, message: string }}
 */
function spinFortuneWheel() {
  const activity = BREAK_ACTIVITIES[Math.floor(Math.random() * BREAK_ACTIVITIES.length)];
  const message =
    `🎡 *КОЛЕСО ФОРТУНЫ!*\n\n` +
    `Выпало: ${activity.emoji} *${activity.name}*\n` +
    `⏱ Время: ${activity.duration} мин\n\n` +
    `${activity.description}\n\n` +
    `_Следующий перерыв через 40 минут!_`;
  return { activity, message };
}

export {
  apiLogger,
  sendMessage,
  sendToTopic,
  parseAgentCommand,
  getFileUrl,
  sendChannelPost,
  sendChannelPhoto,
  getChannelMemberCount,
  dbRun,
  dbGet,
  dbAll,
  isPostgres,
  safeJsonParse,
  ChainHandoffService,
  BREAK_ACTIVITIES,
  spinFortuneWheel,
};

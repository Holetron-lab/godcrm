import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const GRID = [
  '10010001110010010',
  '10010010001010010',
  '10010010001010010',
  '11111010001011111',
  '00010010001000010',
  '00010010001000010',
  '00010001110000010',
];

const LABEL_VARIANTS = {
  en: [
    'Navigation protocol',
    'Signal trace',
    'Ghost index',
    'Route monitor',
    'Operator channel',
  ],
  ru: [
    'Протокол навигации',
    'Сигнал слежения',
    'Призрачный индекс',
    'Маршрут под контролем',
    'Канал оператора',
  ],
};

const TITLE_VARIANTS = {
  en: [
    'The page is gone. You are not.',
    'Address erased. The log remains.',
    'Route empty. You are recorded.',
    'The system remembers. The page does not.',
  ],
  ru: [
    'Страница исчезла. Вы — нет.',
    'Адрес стерт. Запись осталась.',
    'Маршрут пуст. Вы — в журнале.',
    'Система помнит. Страница — нет.',
  ],
};

const TIPS = {
  en: [
    'Tip: If you are lost, open the “Quest” table and pretend it was a plan.',
    'Tip: Drink water before you click “Save”. It feels like mana regen.',
    'Tip: If a table scares you, rename it to “friendly”. It helps 3%.',
    'Tip: The best build is always “backup + patience”.',
    'Tip: Use two-factor. It is like a helmet, but for your data.',
    'Tip: Level up your focus by turning off one notification.',
  ],
  ru: [
    'Совет: если заблудился, открой таблицу «Квесты» и делай вид, что так и надо.',
    'Совет: выпей воды перед «Сохранить». Это +2 к мане.',
    'Совет: если таблица пугает, переименуй её в «милая». Помогает на 3%.',
    'Совет: лучший билд — «бэкап + терпение».',
    'Совет: двухфакторка — это броня. Носи её.',
    'Совет: +1 к фокусу, если выключить одно уведомление.',
  ],
};

const COPY = {
  en: {
    bodyPrimary:
      'We are a smart table system. We can map your life minute by minute. The tables will know where you are, who you are with, what you do.',
    bodySecondary:
      'You become the database — under your control and a council of agents. You decide. Or not, if you choose.',
    security:
      'Guard your access keys. One leak is enough to know everything about you, except what is locked behind a password. Use two-factor authentication — network safety is like safety in the stairwell: one open door, and you are already being read.',
    home: 'Home',
    doom: 'doom',
    doomProtocol: 'DOOM PROTOCOL',
    back: 'Back',
    fullscreen: 'Fullscreen',
    gridLabel: 'Grid of eyes',
    gridTag: 'TRACE 404',
    gridNote: 'Each cell is a mark in the log. Today it spells “404”.',
    tipsTitle: 'RPG tips',
  },
  ru: {
    bodyPrimary:
      'Мы — умная система таблиц. Мы разложим вашу жизнь по минутам. Таблицы будут знать, где вы, с кем вы, что вы делаете.',
    bodySecondary:
      'Вы станете базой данных — под вашим управлением и коллегией агентов. Вы решаете. Или не вы, если захотите.',
    security:
      'Берегите ключи доступа. Одной утечки достаточно, чтобы знать о вас всё, кроме того, что спрятано под паролем. Используйте двухфакторную авторизацию — безопасность в сети как безопасность в подъезде: открытая дверь, и вас уже читают.',
    home: 'На главную',
    doom: 'doom',
    doomProtocol: 'DOOM ПРОТОКОЛ',
    back: 'Вернуться',
    fullscreen: 'Развернуть',
    gridLabel: 'Сетка слежения',
    gridTag: 'TRACE 404',
    gridNote: 'Каждая ячейка — метка в протоколе. Сегодня это «404».',
    tipsTitle: 'RPG-советы',
  },
};

const pickRandom = (list: string[]) => list[Math.floor(Math.random() * list.length)];

const NotFoundPage = () => {
  const cols = GRID[0]?.length || 17;
  const cells = GRID.flatMap((row) => row.split(''));
  const { language } = useLanguage();
  const [doomMode, setDoomMode] = useState(false);
  const doomContainerRef = useRef<HTMLDivElement | null>(null);
  const [signalLabel, setSignalLabel] = useState(() => pickRandom(LABEL_VARIANTS[language]));
  const [signalTitle, setSignalTitle] = useState(() => pickRandom(TITLE_VARIANTS[language]));
  const [signalVisible, setSignalVisible] = useState(true);
  const [tip, setTip] = useState(() => pickRandom(TIPS[language]));

  const copy = COPY[language];

  useEffect(() => {
    setSignalLabel(pickRandom(LABEL_VARIANTS[language]));
    setSignalTitle(pickRandom(TITLE_VARIANTS[language]));
  }, [language]);

  useEffect(() => {
    let active = true;
    let timeoutId: number;

    const schedule = () => {
      setSignalVisible(false);
      const hideFor = 160 + Math.random() * 360;
      timeoutId = window.setTimeout(() => {
        if (!active) return;
        setSignalLabel(pickRandom(LABEL_VARIANTS[language]));
        setSignalTitle(pickRandom(TITLE_VARIANTS[language]));
        setSignalVisible(true);
        const next = 1400 + Math.random() * 2400;
        timeoutId = window.setTimeout(schedule, next);
      }, hideFor);
    };

    schedule();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [language]);

  useEffect(() => {
    setTip(pickRandom(TIPS[language]));
    const intervalId = window.setInterval(() => {
      setTip(pickRandom(TIPS[language]));
    }, 4500);
    return () => window.clearInterval(intervalId);
  }, [language]);

  const handleEnterDoom = () => {
    setDoomMode(true);
  };

  const handleExitDoom = () => {
    setDoomMode(false);
  };

  const handleFullscreen = async () => {
    if (!doomContainerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    await doomContainerRef.current.requestFullscreen?.();
  };

  return (
    <section className="min-h-[calc(100vh-120px)] bg-[var(--bg-primary)] px-6 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.32em] text-[var(--text-tertiary)]">
          <span className="text-[var(--color-primary-400)]">GOD CRM</span>
          <span>404</span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                'radial-gradient(var(--border-secondary) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          />
          <div
            className="absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-80 blur-2xl"
            style={{
              background:
                'radial-gradient(circle, rgba(96,165,250,0.45) 0%, rgba(59,130,246,0.2) 45%, rgba(30,64,175,0) 70%)',
            }}
          />
          <div
            className="absolute -left-24 bottom-[-120px] h-72 w-72 rounded-full opacity-70 blur-3xl"
            style={{
              background:
                'radial-gradient(circle, rgba(147,197,253,0.35) 0%, rgba(59,130,246,0.2) 40%, rgba(30,64,175,0) 70%)',
            }}
          />

          <div className="relative flex flex-col gap-8 p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl space-y-4">
              <div className="space-y-1">
                <p
                  className={`text-xs uppercase tracking-[0.35em] text-[var(--text-tertiary)] transition-opacity duration-500 ${
                    signalVisible ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  {signalLabel}
                </p>
                <h1
                  className={`text-3xl font-semibold text-[var(--text-primary)] transition-opacity duration-500 ${
                    signalVisible ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  {signalTitle}
                </h1>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                {copy.bodyPrimary}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {copy.bodySecondary}
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                {copy.security}
              </p>
              <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--text-tertiary)]">
                  {copy.tipsTitle}
                </p>
                <p className="mt-2 text-sm text-[var(--text-primary)]">{tip}</p>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    to="/dashboard"
                    className="rounded-md bg-[var(--color-primary-600)] px-4 py-2 text-sm font-medium text-white shadow-sm"
                  >
                    {copy.home}
                  </Link>
                  <button
                    type="button"
                    onClick={handleEnterDoom}
                    className="rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
                  >
                    {copy.doom}
                  </button>
                </div>
              </div>
            </div>

            {doomMode ? (
              <div className="flex w-full max-w-2xl flex-col gap-4">
                <div className="flex w-full items-center justify-between text-xs text-[var(--text-tertiary)]">
                  <span>{copy.doomProtocol}</span>
                  <button
                    type="button"
                    onClick={handleExitDoom}
                    className="rounded-md border border-[var(--border-primary)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
                  >
                    {copy.back}
                  </button>
                </div>
                <div
                  ref={doomContainerRef}
                  className="relative h-[420px] w-full overflow-hidden rounded-xl border border-[var(--border-primary)] bg-black"
                >
                  <iframe
                    title="DOOM"
                    src="/doom/index.html"
                    className="h-full w-full"
                    allow="fullscreen; gamepad"
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                  <button
                    type="button"
                    onClick={handleFullscreen}
                    className="rounded-md border border-[var(--border-primary)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
                  >
                    {copy.fullscreen}
                  </button>
                  <Link
                    to="/dashboard"
                    className="rounded-md border border-[var(--border-primary)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]"
                  >
                    {copy.home}
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex w-full max-w-md flex-col items-center gap-4">
                <div className="flex w-full items-center justify-between text-xs text-[var(--text-tertiary)]">
                  <span>{copy.gridLabel}</span>
                  <span className="text-[var(--color-primary-400)]">{copy.gridTag}</span>
                </div>
                <div className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
                  <div
                    className="inline-grid gap-px rounded-lg bg-[var(--border-secondary)] p-px"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {cells.map((cell, idx) => (
                      <div
                        key={`cell-${idx}`}
                        className={`h-4 w-4 sm:h-5 sm:w-5 ${
                          cell === '1'
                            ? 'bg-[var(--color-primary-500)] shadow-[0_0_10px_rgba(59,130,246,0.45)]'
                            : 'bg-[var(--bg-primary)]'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <div className="w-full text-xs text-[var(--text-tertiary)]">
                  {copy.gridNote}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default NotFoundPage;

export const columnTypes = {
  en: {
    text: {
      label: 'Text',
      description: 'Plain text',
    },
    number: {
      label: 'Number',
      description: 'Numeric values',
    },
    email: {
      label: 'Email',
      description: 'Email address',
    },
    url: {
      label: 'URL',
      description: 'URL address',
    },
    phone: {
      label: 'Phone',
      description: 'Phone number',
    },
    datetime: {
      label: 'Date & Time',
      description: 'Date, date+time, month, year, week, quarter',
    },
    time: {
      label: 'Time (cron)',
      description: 'Schedule (HH:MM, day of month)',
    },
    checkbox: {
      label: 'Checkbox',
      description: 'Yes/No',
    },
    select: {
      label: 'Select',
      description: 'One from list',
    },
    'multi-select': {
      label: 'Multi-select',
      description: 'Multiple from list',
    },
    relation: {
      label: 'Relation',
      description: 'Link to rows in another table',
    },
    person: {
      label: 'Person',
      description: 'Link to user',
    },
    file: {
      label: 'File',
      description: 'Attached file',
    },
    password: {
      label: 'Password',
      description: 'Encrypted text',
    },
    formula: {
      label: 'Formula',
      description: 'Calculated field',
    },
    table: {
      label: 'Table',
      description: 'Embedded table (sub-items)',
    },
    rollup: {
      label: 'Rollup',
      description: 'Data aggregation',
    },
    button: {
      label: 'Button',
      description: 'Action button',
    },
    image: {
      label: 'Image',
      description: 'Image',
    },
    audio: {
      label: 'Audio',
      description: 'Audio player',
    },
    vector: {
      label: 'Vector',
      description: 'AI embedding for search',
    },
    dialog: {
      label: 'AI Dialog',
      description: 'AI dialog / conversation',
    },
    chat: {
      label: 'Chat',
      description: 'AI chat conversation',
    },
  },
  ru: {
    text: {
      label: 'Текст',
      description: 'Обычный текст',
    },
    number: {
      label: 'Число',
      description: 'Числовые значения',
    },
    email: {
      label: 'Email',
      description: 'Email адрес',
    },
    url: {
      label: 'Ссылка',
      description: 'URL адрес',
    },
    phone: {
      label: 'Телефон',
      description: 'Номер телефона',
    },
    datetime: {
      label: 'Дата и время',
      description: 'Дата, дата+время, месяц, год, неделя, квартал',
    },
    time: {
      label: 'Время (крон)',
      description: 'Расписание (HH:MM, день месяца)',
    },
    checkbox: {
      label: 'Чекбокс',
      description: 'Да/Нет',
    },
    select: {
      label: 'Выбор (select)',
      description: 'Один из списка',
    },
    'multi-select': {
      label: 'Множественный выбор',
      description: 'Несколько из списка',
    },
    relation: {
      label: 'Связь',
      description: 'Ссылка на строки другой таблицы',
    },
    person: {
      label: 'Пользователь',
      description: 'Ссылка на пользователя',
    },
    file: {
      label: 'Файл',
      description: 'Прикрепленный файл',
    },
    password: {
      label: 'Пароль',
      description: 'Зашифрованный текст',
    },
    formula: {
      label: 'Формула',
      description: 'Вычисляемое поле',
    },
    table: {
      label: 'Таблица',
      description: 'Встроенная таблица (подтовары)',
    },
    rollup: {
      label: 'Сводка',
      description: 'Агрегация данных',
    },
    button: {
      label: 'Кнопка',
      description: 'Кнопка действия',
    },
    image: {
      label: 'Изображение',
      description: 'Картинка',
    },
    audio: {
      label: 'Аудио',
      description: 'Аудио плеер',
    },
    vector: {
      label: 'Вектор',
      description: 'AI эмбеддинг для поиска',
    },
    dialog: {
      label: 'AI Диалог',
      description: 'AI диалог / переписка',
    },
    chat: {
      label: 'Чат',
      description: 'AI чат-разговор',
    },
  },
} as const;

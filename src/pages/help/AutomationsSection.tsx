import {
  Zap, Webhook,
} from 'lucide-react';
import { TriggerCard, ActionTypeCard, AutomationExample } from './SharedComponents';

export function AutomationsSection() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
          <Zap className="inline w-8 h-8 mr-2 text-yellow-500" />
          Автоматизации
        </h1>
        <p className="text-lg text-[var(--text-secondary)]">
          Автоматизируйте рутинные действия. Когда происходит определённое событие —
          система выполняет заданные действия автоматически.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Триггеры (когда запускать)</h2>
        <div className="space-y-3">
          <TriggerCard title="Создание записи" description="Когда в таблицу добавляется новая запись" />
          <TriggerCard title="Обновление записи" description="Когда изменяется любое поле записи" />
          <TriggerCard title="Изменение поля" description="Когда изменяется конкретное поле (например, статус)" />
          <TriggerCard title="Удаление записи" description="Когда запись удаляется из таблицы" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Действия (что делать)</h2>
        <div className="space-y-3">
          <ActionTypeCard title="Отправить уведомление" description="Email или push-уведомление пользователю" />
          <ActionTypeCard title="Обновить запись" description="Автоматически изменить поля записи" />
          <ActionTypeCard title="Создать запись" description="Добавить новую запись в эту или другую таблицу" />
          <ActionTypeCard title="Вызвать Webhook" description="Отправить HTTP-запрос на внешний сервис" />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Примеры автоматизаций</h2>
        <div className="space-y-4">
          <AutomationExample
            trigger="Статус задачи → 'Готово'"
            action="Отправить уведомление автору задачи"
          />
          <AutomationExample
            trigger="Создана новая заявка"
            action="Назначить ответственного менеджера"
          />
          <AutomationExample
            trigger="Дедлайн через 1 день"
            action="Напомнить исполнителю"
          />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Webhooks</h2>
        <div className="bg-[var(--bg-secondary)] rounded-xl p-6 border border-[var(--border-primary)]">
          <div className="flex items-center gap-3 mb-4">
            <Webhook className="w-5 h-5 text-indigo-500" />
            <span className="text-[var(--text-primary)]">Интеграция с внешними сервисами</span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Webhooks позволяют отправлять данные из CRM во внешние системы при определённых событиях.
          </p>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>• Интеграция с Telegram ботами</li>
            <li>• Синхронизация с внешними CRM</li>
            <li>• Отправка данных в аналитические системы</li>
            <li>• Запуск процессов в n8n, Zapier, Make</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

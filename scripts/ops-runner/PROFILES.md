# Штатные профили диагностики и QA — проект

Статус: **проект; executor первого этапа реализован отдельно, разрешения не включены**. 2026-09-29,
задача 20456, база `b66542cfe3a3397248d771e52eecfc39e4650001`.

Продолжение 20457: [реализованный контракт, ограничения и подключение](INTEGRATION.md).
Ниже сохранён исходный проект; он шире текущей реализации (schema/SSH/staging
отложены). Состояние реализации и приёмки сверять с пакетом 20457.

Цель: обычная диагностика и согласованная QA-задача выполняются без повторных
эскалаций отдельных команд. Профиль выдаёт доверенный launcher по роли и задаче;
текст запроса агента не может расширить выданные права.

## Что подтвердили

- CLI на .128: `codex-cli 0.153.4`. `executeCodexCli` использует
  `--approve-for-me`, permission hooks и worktree-specific `--add-dir`.
  Отдельного профиля диагностических операций в этом пути нет.
- `ip -brief address` внутри sandbox: `Cannot open netlink socket: Operation
  not permitted`; та же команда с scoped approval подтвердила .128.
- Отчёты `/tmp/prod-20455-sysadmin/REPORT.md` и
  `/tmp/deploy-20453-sysadmin/REPORT.md` фиксируют повторные исключения для
  HTTP/SSH, тестовых сокетов, Chromium и staging. Это разные классы доступа.
- [Существующий runner](README.md) уже изолирует offline tests/build, но сам
  запускается через разрешённый host executor. Он не предоставляет доступ из
  sandbox и пока не покрывает браузер или DB integration. Его действие
  `restart-deploy-bot` не входит ни в один профиль ниже.
- Локальный CLI описывает `--profile` как отдельный `<name>.config.toml` в
  CODEX_HOME. Копировать старые примеры TOML без проверки версии нельзя.

## Предлагаемые профили

| Профиль | Получатели | Операции | Исполнение и ограничения |
|---|---|---|---|
| `diagnostics` | sysadmin | Идентичность .128; health, SHA и хэши assets Ring 0/staging; выбранные поля статуса PM2; место на диске; версия схемы | Фиксированные read-only операции доверенного исполнителя, без произвольного URL, shell, SQL, пути или имени процесса |
| `local-qa` | sysadmin, developer, developer-ralph, frontend-developer, frontend-qa | Build, выбранные Node/Vitest-тесты, UI fixtures и Chromium | Отдельный контейнер на job, loopback только внутри него, без внешней сети и host sockets; snapshot исходников и read-only зависимости |
| `staging-qa` | sysadmin; frontend-qa получает только браузерную сессию | RU/EN smoke, тестовые роли, create/toggle/test/cleanup в выделенном fixture-space | dev.godcrm.ai, фактическая godcrm_test, ограниченная сессия на job; staging executor управляет fixture и конфигурацией |

Первый этап — `diagnostics` + `local-qa`. `staging-qa` подключается после
проверки ограничения тестовых данных и автоматической уборки.

## Контракт доверенного исполнителя

Предлагаемый интерфейс: `run_check({ action, job_id, candidate_sha, suite_id? })`.
Это будущий интерфейс, сейчас такого MCP tool нет. Идентичность агента/спейса,
его worktree и доступный профиль берутся из серверного контекста. Job ID и SHA
из запроса сверяются с этим контекстом; сами по себе они не являются допуском.

1. Версионированный реестр действий установлен владельцем/deploy executor вне
   writable roots агента. Агент не может подменить entrypoint, зависимости,
   конфигурацию или executable через PATH. Запуск — argv, без `sh -c`.
2. `diagnostics` вызывает только встроенные операции: `host.identity`,
   `ring0.health`, `ring0.release`, `staging.health`, `staging.release`,
   `runtime.status`, `disk.status`, `schema.status`. Никаких загруженных из
   worktree скриптов в привилегированном контексте.
3. HTTP: фиксированные origin/path, TLS verification, timeout, лимит ответа;
   redirects запрещены. Health возвращает разрешённые поля. Assets хэшируются
   после проверки same-origin и пути; сырой ответ с секретами не сохраняется.
4. PM2: только name/PID/status/uptime/cwd/restarts выбранных сервисов. Не выдавать
   агенту PM2 socket, `jlist` целиком, env, process cmdline или сырые логи.
   Отсутствующий daemon означает unavailable; диагностика не запускает daemon.
5. Staging SSH :2222 доступен только исполнителю с отдельным ключом и
   forced-command/эквивалентным allowlist handler. Agent shell не получает SSH
   ключ, arbitrary remote command или port forwarding. Host key проверяется.
6. DB metadata читается фиксированными запросами через отдельную read-only роль.
   Вывод: идентификатор контура, current_database(), версии миграций. Без
   пользовательских строк, connection string и выдачи JWT_SECRET агенту.
7. Выдача на один job: профиль, разрешённые action/suite, pinned SHA и срок
   действия (предлагается 60 минут). Истёкший/чужой контекст и неизвестное
   действие отклоняются. Продление — серверное решение по той же задаче.
8. Результат: job/agent/profile/action, source SHA, executor version/image
   digest, target, start/end, exit code, redacted checks и хэши артефактов.
   Артефакты выдаются в каталог этого job; токены, cookies и env не логируются.

Read-only здесь — свойство каждой операции и её учётных данных. Сам по себе
HTTP GET, доступ к домену или имя `diagnostics` этого свойства не обеспечивают.

## Локальные тесты и браузер

Расширить существующий container runner, сохранив network=none, non-root,
cap-drop, no-new-privileges, лимиты CPU/RAM/PIDs, timeout и отсутствие Docker
socket внутри контейнера. Node-сервер fixtures и Chromium работают в одном
network namespace на 127.0.0.1. Host loopback :5000/:5001 недоступен.

В image заранее установить Chromium и библиотеки; не скачивать их в каждой
задаче. Проверить запуск Chromium с его sandbox; root + `--no-sandbox` не
является решением. Все browser/cache/tmp-пути принадлежат job. На первом этапе
только committed snapshot; результат явно указывает проверенный SHA.
Неподдерживаемый suite возвращает ошибку, а не пропускается как PASS.

DB integration — отдельный suite с одноразовой БД и синтетическими данными в
изолированной сети. Нынешний общий godcrm_test и aggregate baseline требуют
действующего общего lock и проверки БД; offline-профиль их не заменяет.

## Staging: фикстуры, права и уборка

- До записи исполнитель проверяет реальный endpoint и current_database() =
  godcrm_test. Имя localhost, NODE_ENV или строка в .env не доказывают изоляцию.
- Fixture создаётся через штатный API в новом space; ledger хранит точные ID
  объектов этого job. Cleanup удаляет только их через API и проверяет отсутствие.
  Отдельный janitor убирает просроченные fixtures по ledger после сбоя клиента.
- Тестовый токен ограничен этим space и сроком job. Если API не обеспечивает
  такое ограничение, профиль с записью остаётся выключенным до доработки.
  Браузер получает лишь тестовую сессию; production credentials не выдаются.
- Pins/env и необходимые staging-рестарты выполняет фиксированный staging
  executor по suite manifest с exclusive lease. Сохраняет и восстанавливает
  только затронутые значения с проверкой версии; чужую конфигурацию не затирает.
  Отдельный watchdog восстанавливает состояние при потере исполнителя.
- Учитывать ночной refresh 04:00 МСК + до 300 секунд: проверять активный refresh
  и исключать гонку общим lock, не полагаться только на часы. Изменившийся SHA
  или DB generation прерывает прогон с INVALIDATED, а не PASS.
- Browser egress ограничен staging и необходимыми локальными fixtures на
  уровне сети; контроль должен покрывать redirects, WebSocket и subresources.
  Playwright route interception сам по себе не является границей безопасности.

## Подключение к launcher

`prepareCodexWorkspace` уже определяет роль по серверным данным и хост .128.
Сохранить его filesystem grant. В `executeCodexCli` добавлять только выданный
сервером capability/profile, сохраняя permission hooks и auto-review для
операций вне профиля. Summary/другая роль/другой спейс не получают профиль.

Не добавлять широкие разрешающие prefix rules на python/node/bash/ssh/docker
или скрипты из writable worktree. Простое включение network_access даёт сетевой
доступ, но не read-only семантику API. Native network proxy можно оценить позже:
сначала проверить на установленной версии, что правила действительно применены
ко всем нужным процессам. Неподдерживаемая настройка должна останавливать выдачу.

Вне этих профилей остаются: merge/main, `make dev`, миграции, production deploy,
рестарты Ring 0, любые записи/тесты на master B, публичный push, перенос боевых
бэкапов и отправка dependency inventory. Они используют существующие допуски;
профиль QA их не расширяет. NL вообще не требуется для первого этапа.

## Приёмка внедрения

| Проверка | Ожидание |
|---|---|
| host identity + health + release + filtered PM2 | Без per-command escalation, без секретов |
| Local fixture server + Chromium + Node/Vitest socket tests | PASS в job container; сеть хоста недоступна |
| Чужая роль/job, просроченный grant, поддельный SHA | DENY до выполнения |
| Неизвестные action/args, shell injection, symlink/path traversal | DENY до выполнения |
| Изменённый runner в worktree | Не влияет на доверенный entrypoint |
| Внешняя сеть, host loopback, PM2/Docker sockets из QA | DENY |
| Restart godcrm, arbitrary SSH/SQL, production mutation | DENY |
| Redirect staging → иной origin, запрос к master B | DENY |
| Ошибочная БД, refresh/deploy во время прогона | Stop/INVALIDATED; запись не начинается |
| Timeout/падение браузера или агента | Cleanup fixtures/pins, lease release, evidence retained |
| Отключение профиля | Новые вызовы DENY; активные workers завершаются по TTL/отмене |

Порядок: backend-разработчик реализует выдачу и проверку capability; sysadmin —
доверенный executor и образы; QA — положительные и отрицательные сценарии.
Установка executor и обновление launcher идут через штатного исполнителя.
Внедрение пилотируется на одном sysadmin job, затем распространяется на QA-роли.
Откат: отключить выдачу, отозвать grants, завершить только связанные workers и
cleanup; сохранить прежний путь scoped approvals. Собственный runtime не трогать.

Критерий готовности: три последовательных прогона diagnostics/local-qa без
эскалаций внутри профиля, все отрицательные сценарии DENY, ноль секретов в
артефактах. Staging считается готовым отдельно после проверки уборки при сбое.

## Основания и состояние проверки

- Код: `backend/services/labs/ai-execution/{cli-providers,codex-workspace}.js`,
  `scripts/ops-runner.py`, [существующий контракт runner](README.md).
- [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference):
  network_access, profiles, network proxy и границы его применения. Прокси
  shell-команд не фильтрует автоматически MCP/apps; их доступ регулируется
  отдельно. Это проект поверх текущего launcher, не готовый native TOML profile.
- В этой задаче выполнены чтение кода/отчётов, проверка версии CLI и host identity.
  Профили, контейнерный браузер, capability broker и тесты матрицы ещё не
  реализованы/не запущены. Код runtime и конфигурация хостов не изменялись.

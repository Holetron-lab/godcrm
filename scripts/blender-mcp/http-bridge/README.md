# Blender → GOD CRM: пакет для Joel / @sysadmin

Назначение: пространство **44**, чат **3735**, Mac Intel / macOS 13.7.8,
Python 3.14.2, Blender 4.4.3. Это отдельная программа на Mac; CRM, live,
дополнение Blender и системный Python она не меняет.

Путь: CRM Streamable HTTP + Bearer → HTTPS-туннель → `127.0.0.1:8765/mcp`
→ TCP-дополнение Blender на `127.0.0.1:9877`.

## Установка и локальная приёмка — до туннеля

1. Получить ZIP пакета от разработчика, сверить SHA-256 (`shasum -a 256 <архив>`)
   со значением в передаче. Распаковать в `~/Downloads/blender-http-bridge`.
   Пакет не содержит токен, конфигурацию, виртуальную среду или проект Blender.
2. Оставить открытой копию
   `/Users/a69/Desktop/Новая папка с объектами/scene_crm_copy.blend`.
   В дополнении должно быть `Connected on port 9877`.
3. В Terminal выполнить:

   ```bash
   cd "$HOME/Downloads/blender-http-bridge"
   uv sync --locked --python python3 --no-build
   uv run --locked python bridge.py --init "/Users/a69/Desktop/Новая папка с объектами/scene_crm_copy.blend"
   uv run --locked python bridge.py
   ```

   `uv sync` устанавливает зависимости только в `.venv` этой папки.
   `--no-build` запрещает сборку из исходников. Если установка не проходит,
   передать ошибку @sysadmin; lockfile не обновлять.
   `--init` создаёт `config.json` с токеном из 32 случайных байтов и правами
   `0600`. Существующий файл не перезаписывается. При повторном запуске
   пропустить `--init`. Терминал с мостом оставить открытым.
4. В другом окне Terminal:

   ```bash
   cd "$HOME/Downloads/blender-http-bridge"
   uv run --locked python smoke.py
   ```

   Ожидается `PASS`: отсутствие/неверный токен → **401**, initialize/tools/list
   работают, `get_scene_info` читает нужный файл. Сверить `Scene1_ShadowMan`,
   Blender `4.4.3`, 97 объектов и 12 материалов с последним состоянием сцены.
   Smoke только читает сцену и не показывает токен. При любой ошибке туннель
   пока не запускать. Если `Address already in use`, не останавливать чужой
   процесс — передать ошибку @sysadmin.

## HTTPS и подключение — выполняет @sysadmin вместе с Joel

После успешного локального smoke открыть ещё одно окно Terminal:

```bash
"$HOME/Downloads/cloudflared" tunnel --url http://127.0.0.1:8765 --http-host-header 127.0.0.1:8765
```

Параметр `--http-host-header` обязателен: SDK проверяет Host и возвращает 421
для чужого имени. Проверку не отключать. Туннелировать HTTP-порт **8765**,
не незащищённый TCP-порт Blender 9877. Для этого пилота используется уже
проверенный у Joel cloudflared 2026.10.0; пакет его не устанавливает.
Quick Tunnel выдаст `https://<имя>.trycloudflare.com`; адрес меняется при
перезапуске. Если мешает существующая конфигурация cloudflared, её не удалять:
@sysadmin должен выбрать совместимый способ запуска.

Проверить выданный адрес с Mac, заменив `<имя>`:

```bash
cd "$HOME/Downloads/blender-http-bridge"
uv run --locked python smoke.py --url https://<имя>.trycloudflare.com/mcp
```

Только после PASS в пространстве **44**, «Blender MCP (HTTPS)»:

- URL: `https://<имя>.trycloudflare.com/mcp` (без завершающего `/`, query и редиректов).
- Bearer token: значение из `config.json`, без слова `Bearer`.

Чтобы скопировать токен в буфер Mac без вывода в Terminal:

```bash
cd "$HOME/Downloads/blender-http-bridge"
uv run --locked python -c 'from pathlib import Path; from bridge import load_config; import sys; sys.stdout.write(load_config(Path("config.json")).token)' | pbcopy
```

Вставить его только в поле коннектора; не присылать токен или `config.json`
в чат. После сохранения очистить буфер: `printf '' | pbcopy`.
Если подключение сохраняет агент через API/MCP, сначала прочитать актуальную
схему и проверить полномочия; этот пакет никаких записей в CRM не делает.

Финальная приёмка в CRM: проверить подключение, увидеть оба инструмента и
вызвать `get_scene_info` из пространства 44. Успешный smoke с Mac ещё не
доказывает доступность из CRM. Подключение не закрыто до этого шага.

## Поведение и ограничения

- `get_scene_info()` возвращает имя сцены, путь, версию, число объектов и
  материалов, первые десять объектов. `execute_blender_code(code)` выполняет
  доверенный Python, доступный текущему пользователю Mac. Токен даёт полный
  доступ к такому выполнению; это **не песочница**.
- Путь открытого файла проверяется внутри того же Blender callback, до кода.
  Это защита от случайной правки другого проекта, не ограничение возможностей
  доверенного Python. Код может сам открыть другой файл или обратиться к ОС.
- Все HTTP-методы требуют Bearer; дублирующиеся заголовки и browser Origin
  отклоняются. Порт HTTP всегда loopback, proxy headers не доверяются.
- Один запрос к Blender за раз; второй получает ошибку busy. Лимит входящего
  HTTP — 512 KiB, Python-кода — 65 536 символов, TCP-ответа — 128 KiB.
- Таймаут TCP целиком — 10 секунд, меньше 15 секунд CRM. Прерывание соединения
  **не отменяет уже запущенный Python**. После таймаута или сетевой ошибки
  осмотреть Blender перед повтором; автоматических повторов нет.
  Долгий синхронный рендер этим инструментом не запускать. Асинхронный запуск
  рендера и чтение его состояния — отдельные команды после приёмки канала.
- Мост сам не сохраняет сцену, не меняет аддон, не открывает туннель и не
  устанавливает фоновую службу. Mac/Blender/оба терминала должны работать.
- Отключение: сначала `Ctrl+C` в окне cloudflared, затем в окне моста;
  отключить коннектор CRM. Blender и сохранённый файл остаются открытыми.
  Отзыв токена требует остановки моста и генерации нового приватного конфига;
  не публиковать старый токен повторно.

## Проверки разработчика

Проверено на Linux с Python **3.14.2**: **14 тестов PASS**, включая
реальные HTTP initialize/list/call/cleanup через неизменённый `runRemoteMcp`
CRM (только тестовый fetch направлен на локальную fixture), Python smoke,
отказ без/с неверным токеном, wrong-file guard, Unicode/TCP chunks,
неверные ответы, body/reply limits, busy и 10-секундный timeout без retry.
В fixture используются 97 объектов; это не повторное чтение реального Mac.

Все **29** runtime-зависимостей из lockfile установлены в отдельную временную
папку как binary wheels для `x86_64-apple-darwin`, Python 3.14,
`MACOSX_DEPLOYMENT_TARGET=13.0`, с проверкой hashes. Это проверка доступности
артефактов; запуск Mach-O и Blender на Mac остаётся локальной приёмкой.

Основные pins: `mcp 1.30.0`, `uvicorn 0.54.0`, `pydantic 2.13.5`,
`starlette 1.7.0`, `httpx 0.28.1`. `cryptography 48.0.1` закреплена отдельно:
начиная с 49 upstream убрал Intel Mac wheels. Она нужна транзитивно SDK;
Bearer здесь сравнивается stdlib `secrets.compare_digest`.
Все транзитивные версии и hashes — в `uv.lock`.

Повторить автономные тесты:

```bash
uv run --locked python -m unittest discover -p 'test_*.py' -v
```

В распакованном пакете CRM-client тест пропускается: он требует исходники CRM
и Node из репозитория. Остальные тесты используют только fake Blender.
Starlette выдаёт предупреждение о будущей замене httpx в TestClient; это
предупреждение относится к тестовому адаптеру, текущие закреплённые версии работают.
Frontend/build/staging gates не запускались: нет правок CRM или фронтенда,
деплой не запрошен. Live, PM2, БД и туннели при подготовке не изменялись.

## Источники

- [MCP SDK 1.30.0: FastMCP/Streamable HTTP](https://github.com/modelcontextprotocol/python-sdk/blob/v1.30.0/README.md#streamable-http-transport)
- [TCP/execute_code контракт дополнения](https://github.com/ahujasid/mcp-for-blender/blob/main/addon.py)
- [uv: locked sync](https://docs.astral.sh/uv/concepts/projects/sync/)
- [Cloudflare: HTTP Host Header](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#httphostheader)
- [cryptography: удаление Intel Mac в 49.0.0](https://cryptography.io/en/latest/changelog/#v49-0-0)

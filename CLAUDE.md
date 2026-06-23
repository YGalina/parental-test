# Какой я родитель — тест на автоматическую реакцию

Сайт-тест для родителей детей 6–17 лет. Пользователь проходит 6 кейсов (ситуаций без правильного ответа), получает профиль по 7 шкалам и один из 6 архетипов. Без регистрации, данные только в браузере.

**Production URL:** https://parental-test-production.up.railway.app  
**GitHub:** https://github.com/YGalina/parental-test  
**Владелец:** Galina Yanovskaya (galya.chooru@gmail.com)

---

## Как устроен проект

Это **Next.js 16 приложение**, но в продакшене запускается **не Next.js**, а кастомный Node.js-сервер:

```
scripts/recovery-server.mjs  ← это и есть продакшен-сервер (Railway запускает его)
scripts/telegram-bot.mjs     ← Telegram-бот, стартует внутри recovery-server.mjs
```

Next.js app в `src/app/` существует, но Railway его **не использует** — только `recovery-server.mjs`. Вся логика страниц, HTML, CSS, роутинг — в этом одном файле. Это сознательное архитектурное решение (простота деплоя).

---

## Запуск

```bash
# Локально (recovery-server, как на Railway)
npm run dev:recovery
# открыть http://localhost:3000

# Локально (Next.js dev, не используется в прод)
npm run dev
```

---

## Деплой

Push в `main` → Railway автоматически деплоит.  
Railway запускает: `node scripts/recovery-server.mjs`

Никаких дополнительных команд не нужно — просто `git push`.

---

## Переменные окружения (Railway)

Все задаются в Railway Dashboard → Variables:

| Переменная | Назначение |
|---|---|
| `GEMINI_API_KEY` | Google Gemini — анализ текстовых ответов пользователя |
| `GOOGLE_CLIENT_EMAIL` | Сервисный аккаунт Google — запись результатов в Google Sheets |
| `GOOGLE_PRIVATE_KEY` | Приватный ключ сервисного аккаунта (с `\n` как переносы строк) |
| `GOOGLE_SHEET_ID` | ID Google таблицы для сбора результатов |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота (от @BotFather) |
| `TELEGRAM_CHANNEL` | Username канала с @ (напр. `@kakoy_roditel`) — гейт подписки |
| `TELEGRAM_BOT_USERNAME` | Username бота без @ (напр. `kakoy_roditel_bot`) |
| `PUBLIC_SITE_URL` | Полный URL сайта (напр. `https://parental-test-production.up.railway.app`) |

Локально переменные читаются из `.env.local` (файл не в git).

---

## Структура

```
scripts/
  recovery-server.mjs   — весь продакшен: HTML, CSS, роутинг, логика теста, результаты
  telegram-bot.mjs      — Telegram-бот (воронка: профиль → мини-тест 6 вопросов → гейт канала → архетип)

src/
  app/                  — Next.js app (не используется в прод, но может использоваться в будущем)
  components/           — React компоненты
  data/
    cases.ts            — 6 тестовых кейсов с вопросами и весами ответов
    reaction-framework.ts — 5 вопросов "перед реакцией" (контент для главной)
    foundations.ts      — академические основания методики
    legal.ts            — ссылки на юридические страницы

public/
  archetype-*.png       — изображения 6 архетипов (ч/б иллюстрации)
  favicon.svg
  authors/              — фото авторов
  photos/               — другие фото
```

---

## Архетипы (6 штук)

| Ключ | Название | Описание |
|---|---|---|
| `director` | Дирижёр | Работающая мама, всегда в образе |
| `anchor` | Опора | Тащит всё на себе |
| `mentor` | Наставник | Растит самостоятельного человека |
| `guardian` | Защитник | Любит так сильно, что тревожно |
| `partner` | Партнёр | Скорее друг, чем родитель |
| `peacemaker` | Миротворец | Ссора невыносима |

---

## 7 шкал теста

`adultResponsibility`, `emotionalContact`, `boundariesConsistency`, `autonomySupport`, `conflictTolerance`, `flexibility`, `difficultyVsUnsafety`

Результат считается по весам ответов в `src/data/cases.ts`. Архетип определяется по профилю шкал в `recovery-server.mjs` (функция `scoreToArchetype`).

---

## Telegram-бот

Воронка:
1. `/start` → выбор роли (мать/отец/...) и возраст ребёнка
2. Мини-тест: 6 вопросов с кнопками
3. Гейт подписки на канал (`TELEGRAM_CHANNEL`)
4. Результат: архетип + картинка + ссылка на полный тест

Бот живёт в том же процессе что и сервер. Использует long-polling (не webhook).

---

## Дизайн / стиль

- Тёмная тема: фон `#0a0908`, текст `#f0ede8`
- Акцент: розовый `var(--pink)` = `#f03eb2`, мятный `var(--mint)` = `#36d1a7`
- Шрифт: Cormorant Garamond (serif) для заголовков, system-ui для текста
- Паддинг секций: `clamp(20px, 5vw, 80px)`
- Заголовки секций: класс `.section-header` (grid 1fr/1fr, gap 48px, kicker + h2 слева, описание справа)

---

## Важные нюансы

- **Не трогать `railway.json` и `nixpacks.toml`** — они настроены под деплой recovery-server
- В `recovery-server.mjs` весь HTML пишется как JS-строки — это нормально, так устроен сервер
- Картинки архетипов подключаются через `/archetype-*.png` (из `public/`)
- Если Gemini API недоступен — сервер не падает, используется fallback-анализ
- Данные пользователей хранятся только в localStorage браузера (нет базы данных)

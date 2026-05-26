# Agent Brief — Nee2P. Updates Page

## Task

Create a standalone static HTML page `updates.html` in the project root.  
The page is a **public changelog** for the Nee2P. messenger — a human-readable
history of releases and improvements, written in Russian.

The page must be **self-contained** (one HTML file, no external assets, no JS
frameworks). It follows the exact same visual style as `trust.html` which
already exists in the project.

---

## About the Project

**Nee2P.** (`/2Pee/`) — anonymous end-to-end encrypted messenger.

- **No accounts, no database, no server-side plaintext**
- Sessions identified by a shared secret phrase; up to 2–8 participants
- Crypto stack: Argon2id KDF → X25519 + ML-KEM-768 ECDH → HKDF → AES-256-GCM
- Safety Fingerprint: SHA-256(pubkeys) → 12 BIP-39 words
- Dual transport: WebSocket primary, HTTP long-poll fallback
- PWA: installable, offline-capable, Web Push notifications
- RAM-only relay — no persistence, rooms expire on TTL (default 24 h)
- All vendor libraries bundled locally (no CDN dependency)

**URLs:**
- App: `https://letsmaketelegramgreatagain.com/2Pee/`
- Trust page: `https://letsmaketelegramgreatagain.com/2Pee/trust.html`
- Updates page (to be created): `https://letsmaketelegramgreatagain.com/2Pee/updates.html`
- GitHub: `https://github.com/www7man/Nee2P`

---

## Visual Design System

Copy the CSS exactly from `trust.html`. Key tokens:

```css
:root {
  --bg:       #06060a;
  --fg:       rgba(255,255,255,0.82);
  --fg-dim:   rgba(255,255,255,0.62);
  --fg-mute:  rgba(255,255,255,0.42);
  --accent:   #7be0b1;          /* green — use for dates, tags, highlights */
  --rule:     rgba(255,255,255,0.08);
  --code-bg:  rgba(255,255,255,0.06);
  --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, Menlo, Consolas, "SF Mono", monospace;
  --serif: ui-serif, Georgia, "Times New Roman", serif;  /* used for italic headings */
}
```

**Layout rules:**
- `max-width: 680px; margin: 0 auto; padding: 28px 22px 96px`
- Dark background `#06060a`, body text `rgba(255,255,255,0.82)`
- Headings in `font-family: var(--serif); font-style: italic; font-weight: 400`
- Code/hashes in `font-family: var(--mono)`
- Horizontal rules: `1px solid var(--rule)`
- No rounded cards — flat document style like `trust.html`
- Logo in top-left (italic serif "Nee2P." linked to `./`), back link top-right

**Header row (copy from trust.html):**
```html
<header class="top">
  <a href="./" class="logo">Nee2P.</a>
  <a href="./" class="back">← назад</a>
</header>
```

**Section numbering style (copy from trust.html):**
```html
<div class="section-num">01 — РЕЛИЗЫ</div>
```
```css
.section-num {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--fg-mute); font-family: var(--mono); margin-bottom: 10px;
}
```

**CTA button at bottom (copy btn-deal from trust.html):**
```html
<div class="cta-wrap">
  <a href="./" class="btn-deal">Открыть мессенджер <span class="arr">→</span></a>
  <p class="mute">Nee2P. — анонимный зашифрованный чат без следов.</p>
</div>
```

---

## Changelog Content

Write all entries in **Russian**. Dates are approximate (all in 2025–2026).
Each entry = one release block.

---

### Version 0.1.0 — «hush. initial snapshot»
**Дата:** начало 2025  
**Тег:** `первый запуск`

- Запуск проекта под именем **hush.**
- Анонимный зашифрованный чат для двух участников
- Ключ сессии выводится через PBKDF2-SHA256 из секретной фразы
- Транспорт: WebSocket, два слота на комнату (A/B)
- Серверная часть: ~100 строк Node.js, без базы данных, комнаты только в RAM
- Фронтенд: React 18 + Babel in-browser, без сборщика

---

### Version 0.2.0 — «Nee2P. rebrand»
**Дата:** май 2026  
**Тег:** `ребрендинг`

- Проект переименован из **hush.** в **Nee2P.**
- Все файлы `hush-*.jsx` переименованы в `nee2p-*.jsx`
- Обновлены ссылки, мета-теги, launchd plist

---

### Version 0.3.0 — «/r/peek probe»
**Дата:** май 2026  
**Тег:** `API`

- Новый endpoint `/r/peek` — read-only проверка существования сессии
- Возвращает `{exists, groupMax, claimed, online, expiresAt}` без занятия слота
- Безопасен для неаутентифицированных запросов (не создаёт и не меняет данные)
- Фронтенд: хелпер `window.Nee2PPeek.peekRoom(hash)` в `http-client.js`

---

### Version 0.4.0 — «UX: создание и вход»
**Дата:** май 2026  
**Тег:** `UX · безопасность`

**Создание сессии:**
- Упрощён экран создания: фраза на первом месте, кнопка «случайный код»
- Ввод фразы всегда переводится в нижний регистр — исключены ошибки при подключении из-за регистра

**Экран входа (JoinScreen):**
- Живой бейдж `/r/peek`: пока пользователь вводит фразу, показывается сколько участников онлайн и сколько мест осталось
- Если сессии с такой фразой нет — предлагается её создать без повторного ввода

---

### Version 0.5.0 — «PWA»
**Дата:** май 2026  
**Тег:** `PWA · офлайн`

- Service Worker (`sw.js`): network-first для навигации, cache-first для ассетов
- `manifest.json`: приложение устанавливается на домашний экран
- Web Push уведомления (`push.js`) — опционально, с явным разрешением
- IndexedDB persistence (`persistence.js`): сессия переживает перезагрузку страницы с опцией «Запомнить на этом устройстве»
- Иконки 192×192 и 512×512

---

### Version 0.6.0 — «Страница проверки честности»
**Дата:** май 2026  
**Тег:** `доверие · прозрачность`

- Добавлена страница `trust.html` — пошаговые инструкции как убедиться что у нас нет бэкдоров
- Объяснение архитектуры: сервер физически не может прочитать сообщения
- Описание криптостека: Argon2id, X25519, ML-KEM-768, AES-256-GCM
- Инструкции для самостоятельной проверки через DevTools, SRI, исходный код
- CTA-кнопка «Безопасность сделки» с анимированной стрелкой

---

### Version 0.7.0 — «3-шаговый визард создания сессии»
**Дата:** май 2026  
**Тег:** `UX`

Создание сессии разбито на три экрана с объяснением каждого шага:

| Шаг | Экран | Что объясняется |
|-----|-------|----------------|
| 1 | **Секретная фраза** | Обрабатывается в браузере через Argon2id, на сервер уходит только MD5-хеш — восстановить фразу невозможно |
| 2 | **Параметры сессии** | Срок жизни (1 ч — 7 дней) и число участников (2–8) задаются один раз |
| 3 | **Пароль входа** | Только на устройстве, не передаётся по сети, не участвует в шифровании сообщений |

- Индикатор прогресса — анимированные пилюли между экранами
- Кнопка назад возвращает на предыдущий шаг
- Кнопка «Далее» без фразы → автоматически генерирует безопасный код

---

### Version 0.7.1 — «Фиксы»
**Дата:** май 2026  
**Тег:** `исправления`

- **QR-модал**: переведён на `position: fixed` + `z-index: 9999` — уведомления больше не перекрывают QR-код на мобильных
- **Имена глобальных переменных**: `HushCrypto` → `Nee2PCrypto`, `HushPersist` → `Nee2PPersist`, `HushPush` → `Nee2PPush` — устранено зависание «создаём…» после ребрендинга
- Все продакшн-файлы синхронизированы с dev

---

## Page Structure

```
<header>          Nee2P. ← назад
<hero>            *Журнал изменений.*
                  Что нового в каждой версии.
<section>         01 — ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ   ← самое новое первым
                  v0.7.1 — Исправления
                  [список фиксов]
<section>         02 — ИСТОРИЯ ВЕРСИЙ
                  v0.7.0, v0.6.0 … v0.1.0
                  каждая версия = блок с датой, тегами, списком изменений
<footer>          CTA-кнопка "Открыть мессенджер →"
                  footer: Nee2P. — anonymous paired messenger
```

---

## Entry Block Template

Each version block:

```html
<div class="release">
  <div class="release-meta">
    <span class="release-version">v0.7.0</span>
    <span class="release-date">май 2026</span>
    <span class="release-tag">UX</span>
  </div>
  <h3 class="release-title">3-шаговый визард создания сессии</h3>
  <ul>
    <li>...</li>
  </ul>
</div>
<hr />
```

Style tags as small pill badges:
```css
.release-tag {
  display: inline-block;
  padding: 2px 8px; border-radius: 9999px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.8px;
  text-transform: uppercase; font-family: var(--mono);
  background: rgba(123,224,177,0.12);
  color: var(--accent);
  border: 0.5px solid rgba(123,224,177,0.25);
}
.release-version {
  font-family: var(--mono); font-size: 13px;
  color: var(--accent); font-weight: 700;
}
.release-date {
  font-size: 12px; color: var(--fg-mute);
}
.release-meta {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
```

---

## Dos and Don'ts

**Do:**
- Newest version first
- Keep entries concise — bullet points, not essays
- Use `<code>` for file names, endpoints, variable names
- Use the same serif italic style for h2 section headings as trust.html
- Add `<meta name="robots" content="noindex" />` (internal page)
- Link GitHub at the bottom: `https://github.com/www7man/Nee2P`

**Don't:**
- Don't add JavaScript (pure HTML+CSS)
- Don't use external fonts or CDN links — system fonts only
- Don't invent features not listed in this brief
- Don't add a search or filter UI
- Don't use bright backgrounds or cards — flat dark document like trust.html

# Nee2P Lite

**Один HTML-файл. Никаких серверов от Nee2P. Federated discovery через WebTorrent trackers. End-to-end PQ-крипто.**

```
┌─────────────────────────────────────────────────────┐
│  Алиса                              Боб             │
│  ────                               ───             │
│  open nee2p-lite.html              open nee2p-lite.html
│  вводит фразу ────────────────────► та же фраза     │
│       │                                 │           │
│       ▼                                 ▼           │
│   Argon2id → info_hash + PSK + AES-key             │
│       │                                 │           │
│       └─►  WebTorrent trackers (~6 публичных)  ◄──┘ │
│              wss://tracker.openwebtorrent.com       │
│              wss://tracker.btorrent.xyz             │
│              wss://tracker.webtorrent.dev           │
│              ...                                    │
│       │                                 │           │
│       ▼      SDP/ICE обмен              ▼           │
│       │   (защищён PSK-HMAC)            │           │
│       │                                 │           │
│       └─► WebRTC peer-to-peer ◄────────┘            │
│              DataChannel                            │
│              AES-256-GCM поверх                     │
└─────────────────────────────────────────────────────┘
```

## Что это и чем отличается от основного Nee2P

Lite — это **альтернативная архитектура** для специфичных сценариев, не замена основного Nee2P.

| | Nee2P (основной) | Nee2P Lite |
|---|---|---|
| Серверов от Nee2P | 1 relay | 0 |
| Discovery | свой relay | federated WebTorrent trackers |
| Хостинг | свой VPS / Docker / Render | нечего хостить |
| Распространение | URL: `Nee2P.com` | один HTML-файл |
| Async-доставка | работает (TTL до 7 дней) | **не работает** (оба должны быть онлайн) |
| Push-уведомления | через relay | невозможны |
| Group chat | 2–8 | пока только 2 |
| Voice calls | есть (WebRTC) | пока нет |
| File transfer | через `/r/blob` | пока нет |

## Когда выбирать Lite

- Высокие требования к аудиту — один файл, читается `nano`'ом
- Цензуроустойчивость — нет single point to block (10+ независимых trackers)
- Off-grid / sneakernet — файл передаётся через любой канал
- Долговечность — файл работает через 10 лет независимо от того, существует ли проект
- Параноидальный сценарий — пользователь не доверяет никаким серверам, включая Nee2P

## Когда выбирать основной Nee2P

- Нужны async-сообщения (пир получит когда зайдёт)
- Нужны push-уведомления
- Группы 3-8 человек
- Voice calls
- Mobile-first (iOS Safari имеет ограничения на background WebRTC)

## Как использовать

1. Скачайте `nee2p-lite.html` (с GitHub Releases, IPFS, или у друга на флешке)
2. Откройте двойным кликом в браузере
3. Введите общую фразу с собеседником
4. Дождитесь установки соединения (обычно 3-10 секунд)
5. Сравните 12 BIP-39 слов через отдельный канал (защита от MITM)
6. Пишите

## Крипто-стек

Идентичен основному Nee2P:

- **KDF:** Argon2id (t=3, m=64MiB, p=1) от фразы → 32 байта master key
- **Discovery:** `info_hash = SHA-1(master_key)` — детерминированный room ID для tracker'ов
- **PSK:** `psk = HKDF(master_key, "nee2p-lite-psk-v1")` — защищает handshake от подсадки tracker'ом fake-пира
- **PQ key exchange:** X25519 (ephemeral) + ML-KEM-768 (FIPS 203) гибрид через HKDF
- **Session key:** AES-256-GCM, свежий 12-байт IV на каждое сообщение
- **Safety fingerprint:** SHA-256 публичных ключей → 12 BIP-39 слов (сравнить out-of-band)

## Защита от tracker'а

Tracker видит:
- `info_hash` — детерминированный, но без знания фразы реверсу не подлежит (Argon2id)
- IP-адреса пиров
- Зашифрованные SDP/ICE пакеты
- Момент handshake

Tracker **не видит**:
- Фразу
- Содержимое сообщений
- Ключи
- Метаданные после handshake (всё идёт peer-to-peer)

Tracker **не может**:
- Подсадить fake-пира — PSK-HMAC отбрасывает любой SDP без знания фразы
- Расшифровать сообщения — даже если он MITM'ит handshake, X25519+ML-KEM session key недостижим без фразы
- Залогировать содержимое — после WebRTC handshake tracker'а в data-path больше нет

## Известные ограничения

1. **Symmetric NAT (~10% сетей)** — для прохода нужен TURN-сервер. Lite использует только публичные STUN, без TURN. В strict NAT соединение может не установиться.
2. **iOS Safari в standalone PWA** — WebRTC ограничено в фоне.
3. **Async** — оба пира должны быть онлайн одновременно. Если Боб открыл файл через 3 часа после Алисы — Алиса должна быть всё ещё в комнате.
4. **Hot security fixes** — нет автообновления. Юзер сам качает новый HTML, когда находит критичный fix.

## Файлы

- `nee2p-lite.html` — единственный артефакт. Открывается двойным кликом.
- `README.md` — этот файл.

## Лицензия

MIT, как и основной проект.

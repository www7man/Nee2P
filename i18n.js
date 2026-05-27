// i18n.js — Nee2P. internationalisation layer.
//
// Exposes window.Nee2Pi18n:
//   t(key)            — returns translated string for current lang
//   setLang(lang)     — switch language ('ru' | 'en'), persists in localStorage
//   getLang()         — returns current lang code
//   onLangChange(fn)  — subscribe to lang changes, returns unsubscribe fn
//   useLang()         — React hook: returns [lang, setLang], triggers re-render
//   LANGS             — array of available lang codes
//
// Adding a new language: add its code to LANGS and a full translations block
// in TRANSLATIONS. The sub-agent doing translations works only in this file.

(function (g) {
  const LANGS = ['ru', 'en'];

  const TRANSLATIONS = {
    ru: {
      // ── Welcome ──────────────────────────────────────────────────────────
      'welcome.tagline':   'Это безопасно.',
      'welcome.phrases':   ['один код', 'один секрет', 'ключи стираются', 'ни следа'],
      'welcome.desc':      'Технология с открытым исходным кодом для безопасных переписок и передачи данных.',
      'welcome.opensource':'Открытый исходный код',
      'welcome.create':    'Создать сессию',
      'welcome.join':      'Подключиться к сессии',
      'welcome.security':  'Безопасность',
      'welcome.updates':   'Что нового',

      // ── Created (3-step wizard) ──────────────────────────────────────────
      'created.title':           'Сессия создана',
      'created.share':           'Поделитесь фразой с собеседником',
      'created.copy':            'Скопировать',
      'created.copied':          'Скопировано',
      'created.qr':              'QR-код',
      'created.waiting':         'Ожидание собеседника…',
      'created.connected':       'Собеседник подключился',
      'created.step1.title':     'Секретная фраза',
      'created.step1.hint':      'Фраза — ваш общий секрет. Она обрабатывается в браузере через Argon2id; на сервер уходит только MD5-хеш — восстановить фразу по нему невозможно.',
      'created.step1.placeholder': 'например: пушкин-кафе-22',
      'created.step1.random':    '⤵ случайный код',
      'created.step1.next_generate': 'Сгенерировать и продолжить',
      'created.step2.title':     'Параметры сессии',
      'created.step2.hint':      'Срок жизни — когда сессия самоуничтожится. Число мест — сколько человек может подключиться. После создания изменить нельзя.',
      'created.step2.ttl_label': 'активна · сколько времени',
      'created.step2.slots_label': 'участников · максимум',
      'created.step2.slots_two': '2 — личная переписка (по умолчанию)',
      'created.step3.title':     'Пароль входа',
      'created.step3.hint':      'Защищает вход с этого устройства. Каждый участник задаёт свой пароль — по сети он не передаётся и не участвует в шифровании сообщений.',
      'created.step3.hash_label': 'идентификатор сессии · MD5',
      'created.step3.pwd_label':  'твой пароль · мин 4 символа',
      'created.step3.pwd_placeholder': 'придумай',
      'created.step3.busy':       'создаём…',
      'created.step3.need_pwd':   'введите пароль',

      // ── Join ──────────────────────────────────────────────────────────────
      'join.title':        'Подключиться',
      'join.subtitle':     'Введите секретную фразу сессии',
      'join.placeholder':  'любая фраза или 32 символа хеша',
      'join.clear':        'стереть',
      'join.find':         'Найти сессию',
      'join.enter_phrase': 'введите фразу',
      'join.back':         'Назад',
      'join.connect':      'Подключиться',
      'join.connecting':   'подключение…',
      'join.need_pwd':     'нужен пароль',
      'join.pwd_placeholder': 'твой секрет',
      'join.create_instead': 'Создать новую сессию',
      'join.create_with_phrase': 'Создать с этой фразой',
      'join.change_phrase':  'Изменить фразу',
      'join.checking':       'Проверяем сессию…',
      'join.net_retry':      'Проверьте сеть и попробуйте снова',
      'join.not_found':      'Сессия не найдена',
      'join.no_session':     'Нет активной сессии с этой фразой.',
      'join.suggest_create': 'Можно создать новую и поделиться ссылкой.',
      'join.found':          'Сессия найдена',
      'join.all_in':         'все участники вошли',
      'join.all_slots_taken':'все слоты заняты',
      'join.waiting_for_users': 'ждёт участников',
      'join.label_slots':    'участников',
      'join.label_online':   'онлайн сейчас',
      'join.label_free':     'свободно мест',
      'join.label_created':  'создана',
      'join.label_expires':  'истекает через',
      'join.online_of':      'из',
      'join.nobody':         'никого',
      'join.full_msg':       'Все слоты заняты — войти не получится.',
      'join.full_hint':      'Попробуйте другую фразу или создайте новую сессию.',
      'join.slots':          'Участников',
      'join.online':         'Онлайн сейчас',
      'join.free':           'Свободно мест',
      'join.created':        'Создана',
      'join.expires':        'Истекает через',
      'join.full':           'Сессия заполнена',
      'join.paired':         'Сессия занята',

      // ── Password ──────────────────────────────────────────────────────────
      'pwd.title':         'Пароль сессии',
      'pwd.placeholder':   'Пароль (необязательно)',
      'pwd.placeholder_old': 'ваш секрет',
      'pwd.hint':          'Минимум 4 символа',
      'pwd.connect':       'Подключиться',
      'pwd.remember':      'Запомнить на этом устройстве',
      'pwd.remember_desc': 'После закрытия вкладки сессия откроется автоматически. Фраза и пароль будут зашифрованы в браузере.',
      'pwd.strength':      ['слишком короткий', 'слабый', 'нормально', 'хорошо', 'надёжный'],
      'pwd.step_label':    'шаг 2 из 2 · ваш секрет',
      'pwd.headline_top':  'Придумайте',
      'pwd.headline_bottom': 'секретный ключ',
      'pwd.subtitle':      'Только вы это знаете. Если забудете — сессия исчезнет.',
      'pwd.you_are':       'вы —',
      'pwd.side_a':        'сторона A',
      'pwd.side_b':        'сторона B',
      'pwd.warn_strong':   'Ничего не хранится.',
      'pwd.warn_body':     'Оба секрета открывают сессию. Потеряете любой — переписка исчезнет навсегда.',
      'pwd.seal_continue': 'Запечатать и продолжить',
      'pwd.min_4':         'мин. 4 символа',

      // ── Chat ─────────────────────────────────────────────────────────────
      'chat.placeholder':  'Сообщение…',
      'chat.send':         'Отправить',
      'chat.waiting':      'Ожидание собеседника…',
      'chat.encrypted':    'Сообщения шифруются на устройстве',
      'chat.connecting':   'Подключение…',
      'chat.reconnecting': 'Переподключение…',
      'chat.conn_lost':    'соединение потеряно — переподключаемся…',
      'chat.conn_unstable':'соединение нестабильно — переподключаемся…',
      'chat.reload':       'Перезагрузить',
      'chat.session_open': 'сессия открыта',
      'chat.search_placeholder': 'искать в чате',
      'chat.load_more':    'Загрузить ещё',
      'chat.call':         'Позвонить',
      'chat.call_offline_hint': 'Собеседник может быть не в сети — попробовать',
      'chat.call_incoming':'Входящий звонок',
      'chat.call_answer':  'Ответить',
      'chat.call_reject':  'Отклонить',
      'chat.call_end':     'Завершить',
      'chat.call_mute':    'Микрофон',
      'chat.call_speaker': 'Динамик',
      'chat.call_connecting': 'Соединяемся…',
      'chat.call_active':  'Звонок',
      'chat.call_no_conn': 'Нет соединения',
      'chat.call_no_support': 'Звонки не поддерживаются в этом браузере',
      'chat.check_keys':   'Проверьте ключи',
      'chat.recording':    'Запись…',
      'chat.hold_record':  'Удержать для записи голоса',
      'chat.reply':        'Ответить',
      'chat.copy_msg':     'Копировать',
      'chat.delete_msg':   'Удалить',
      'chat.file_attach':  'Прикрепить файл',
      'chat.invite':       'Пригласить',
      'chat.invite_title': 'Пригласить участника',
      'chat.leave':        'Покинуть сессию',
      'chat.security':     'Безопасность сессии',
      'chat.search':       'Поиск',
      'chat.search_title': 'Поиск по сообщениям',
      'chat.online':       'online',
      'chat.offline':      'offline',
      'chat.typing':       'печатает',

      // ── Common ────────────────────────────────────────────────────────────
      'common.cancel':     'Отмена',
      'common.close':      'Закрыть',
      'common.done':       'Готово',
      'common.next':       'Далее',
      'common.loading':    'Загрузка…',
      'common.error':      'Ошибка',
      'common.retry':      'Повторить',
      'common.no_conn':    'Нет соединения',
      'common.back':       'Назад',
    },

    en: {
      // ── Welcome ──────────────────────────────────────────────────────────
      'welcome.tagline':   'This is secure.',
      'welcome.phrases':   ['one code', 'one secret', 'keys erased', 'no trace'],
      'welcome.desc':      'Open source technology for private messaging and data transfer.',
      'welcome.opensource':'Open Source',
      'welcome.create':    'Create session',
      'welcome.join':      'Join a session',
      'welcome.security':  'Security',
      'welcome.updates':   "What's new",

      // ── Created (3-step wizard) ──────────────────────────────────────────
      'created.title':           'Session created',
      'created.share':           'Share this phrase with your contact',
      'created.copy':            'Copy',
      'created.copied':          'Copied',
      'created.qr':              'QR Code',
      'created.waiting':         'Waiting for contact…',
      'created.connected':       'Contact connected',
      'created.step1.title':     'Secret phrase',
      'created.step1.hint':      'The phrase is your shared secret. It is processed in your browser via Argon2id; only the MD5 hash leaves the device — the phrase cannot be recovered from it.',
      'created.step1.placeholder': 'e.g. pushkin-cafe-22',
      'created.step1.random':    '⤵ random code',
      'created.step1.next_generate': 'Generate and continue',
      'created.step2.title':     'Session settings',
      'created.step2.hint':      'TTL — when the session self-destructs. Slot count — how many people can join. Cannot be changed after creation.',
      'created.step2.ttl_label': 'active · for how long',
      'created.step2.slots_label': 'participants · maximum',
      'created.step2.slots_two': '2 — private chat (default)',
      'created.step3.title':     'Entry password',
      'created.step3.hint':      'Protects entry from this device. Each participant sets their own password — it is never sent over the network and is not used to encrypt messages.',
      'created.step3.hash_label': 'session id · MD5',
      'created.step3.pwd_label':  'your password · min 4 chars',
      'created.step3.pwd_placeholder': 'choose one',
      'created.step3.busy':       'creating…',
      'created.step3.need_pwd':   'enter a password',

      // ── Join ──────────────────────────────────────────────────────────────
      'join.title':        'Join',
      'join.subtitle':     'Enter the session phrase',
      'join.placeholder':  'any phrase or 32-char hash',
      'join.clear':        'clear',
      'join.find':         'Find session',
      'join.enter_phrase': 'enter phrase',
      'join.back':         'Back',
      'join.connect':      'Connect',
      'join.connecting':   'connecting…',
      'join.need_pwd':     'password required',
      'join.pwd_placeholder': 'your secret',
      'join.create_instead': 'Create a new session',
      'join.create_with_phrase': 'Create with this phrase',
      'join.change_phrase':  'Change phrase',
      'join.checking':       'Checking session…',
      'join.net_retry':      'Check your network and try again',
      'join.not_found':      'Session not found',
      'join.no_session':     'No active session with this phrase.',
      'join.suggest_create': 'You can create a new one and share the link.',
      'join.found':          'Session found',
      'join.all_in':         'all participants joined',
      'join.all_slots_taken':'all slots are taken',
      'join.waiting_for_users': 'waiting for participants',
      'join.label_slots':    'participants',
      'join.label_online':   'online now',
      'join.label_free':     'free slots',
      'join.label_created':  'created',
      'join.label_expires':  'expires in',
      'join.online_of':      'of',
      'join.nobody':         'nobody',
      'join.full_msg':       'All slots are taken — you cannot join.',
      'join.full_hint':      'Try another phrase or create a new session.',
      'join.slots':          'Participants',
      'join.online':         'Online now',
      'join.free':           'Free slots',
      'join.created':        'Created',
      'join.expires':        'Expires in',
      'join.full':           'Session is full',
      'join.paired':         'Session is taken',

      // ── Password ──────────────────────────────────────────────────────────
      'pwd.title':         'Session password',
      'pwd.placeholder':   'Password (optional)',
      'pwd.placeholder_old': 'your secret',
      'pwd.hint':          'At least 4 characters',
      'pwd.connect':       'Connect',
      'pwd.remember':      'Remember on this device',
      'pwd.remember_desc': 'The session will reopen automatically after closing the tab. Phrase and password will be encrypted in the browser.',
      'pwd.strength':      ['too short', 'weak', 'ok', 'good', 'strong'],
      'pwd.step_label':    'step 2 of 2 · your secret',
      'pwd.headline_top':  'Choose your',
      'pwd.headline_bottom': 'secret key',
      'pwd.subtitle':      'Only you know it. If you forget — the session is gone.',
      'pwd.you_are':       'you are —',
      'pwd.side_a':        'side A',
      'pwd.side_b':        'side B',
      'pwd.warn_strong':   'Nothing is stored.',
      'pwd.warn_body':     'Both secrets unlock the session. Lose either one and the chat is gone forever.',
      'pwd.seal_continue': 'Seal and continue',
      'pwd.min_4':         'min. 4 characters',

      // ── Chat ─────────────────────────────────────────────────────────────
      'chat.placeholder':  'whisper something…',
      'chat.send':         'Send',
      'chat.waiting':      'Waiting for contact…',
      'chat.encrypted':    'Messages are encrypted on device',
      'chat.connecting':   'Connecting…',
      'chat.reconnecting': 'Reconnecting…',
      'chat.conn_lost':    'connection lost — reconnecting…',
      'chat.conn_unstable':'connection unstable — reconnecting…',
      'chat.reload':       'Reload',
      'chat.session_open': 'session open',
      'chat.search_placeholder': 'search in chat',
      'chat.load_more':    'Load more',
      'chat.call':         'Call',
      'chat.call_offline_hint': 'Peer may be offline — try anyway',
      'chat.call_incoming':'Incoming call',
      'chat.call_answer':  'Answer',
      'chat.call_reject':  'Decline',
      'chat.call_end':     'End call',
      'chat.call_mute':    'Mic',
      'chat.call_speaker': 'Speaker',
      'chat.call_connecting': 'Connecting…',
      'chat.call_active':  'In call',
      'chat.call_no_conn': 'No connection',
      'chat.call_no_support': 'Calls not supported in this browser',
      'chat.check_keys':   'Verify keys',
      'chat.recording':    'Recording…',
      'chat.hold_record':  'Hold to record voice',
      'chat.reply':        'Reply',
      'chat.copy_msg':     'Copy',
      'chat.delete_msg':   'Delete',
      'chat.file_attach':  'Attach file',
      'chat.invite':       'Invite',
      'chat.invite_title': 'Invite participant',
      'chat.leave':        'Leave session',
      'chat.security':     'Session security',
      'chat.search':       'Search',
      'chat.search_title': 'Search messages',
      'chat.online':       'online',
      'chat.offline':      'offline',
      'chat.typing':       'typing',

      // ── Common ────────────────────────────────────────────────────────────
      'common.cancel':     'Cancel',
      'common.close':      'Close',
      'common.done':       'Done',
      'common.next':       'Next',
      'common.loading':    'Loading…',
      'common.error':      'Error',
      'common.retry':      'Retry',
      'common.no_conn':    'No connection',
      'common.back':       'Back',
    },
  };

  // ── State ────────────────────────────────────────────────────────────────
  const stored = typeof localStorage !== 'undefined' && localStorage.getItem('nee2p_lang');
  const browserLang = typeof navigator !== 'undefined' && navigator.language
    ? (navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en')
    : 'ru';
  let currentLang = (stored && LANGS.includes(stored)) ? stored : browserLang;

  const listeners = new Set();

  // ── API ──────────────────────────────────────────────────────────────────
  function t(key) {
    const dict = TRANSLATIONS[currentLang];
    if (dict && key in dict) return dict[key];
    // fallback to RU
    return (TRANSLATIONS.ru && TRANSLATIONS.ru[key]) || key;
  }

  function setLang(lang) {
    if (!LANGS.includes(lang) || lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem('nee2p_lang', lang); } catch {}
    listeners.forEach(fn => { try { fn(lang); } catch {} });
  }

  function getLang() { return currentLang; }

  function onLangChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // React hook — safe to call before React loads (only resolves at call time)
  function useLang() {
    const [lang, setLangState] = React.useState(currentLang);
    React.useEffect(() => {
      // sync if lang changed between renders
      if (currentLang !== lang) setLangState(currentLang);
      return onLangChange(newLang => setLangState(newLang));
    }, []);
    return [lang, setLang];
  }

  g.Nee2Pi18n = { t, setLang, getLang, onLangChange, useLang, LANGS, TRANSLATIONS };

})(typeof window !== 'undefined' ? window : globalThis);

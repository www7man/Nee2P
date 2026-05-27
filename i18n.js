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

      // ── Created ───────────────────────────────────────────────────────────
      'created.title':     'Сессия создана',
      'created.share':     'Поделитесь фразой с собеседником',
      'created.copy':      'Скопировать',
      'created.copied':    'Скопировано',
      'created.qr':        'QR-код',
      'created.waiting':   'Ожидание собеседника…',
      'created.connected': 'Собеседник подключился',

      // ── Join ──────────────────────────────────────────────────────────────
      'join.title':        'Подключиться',
      'join.placeholder':  'Введите фразу или хеш сессии',
      'join.find':         'Найти сессию',
      'join.enter_phrase': 'введите фразу',
      'join.back':         'Назад',
      'join.connect':      'Подключиться',
      'join.create_instead': 'Создать новую сессию',
      'join.no_session':   'Нет активной сессии с этой фразой.',
      'join.suggest_create': 'Можно создать новую и поделиться ссылкой.',
      'join.slots':        'Участников',
      'join.online':       'Онлайн сейчас',
      'join.free':         'Свободно мест',
      'join.created':      'Создана',
      'join.expires':      'Истекает через',
      'join.full':         'Сессия заполнена',
      'join.paired':       'Сессия занята',

      // ── Password ──────────────────────────────────────────────────────────
      'pwd.title':         'Пароль сессии',
      'pwd.placeholder':   'Пароль (необязательно)',
      'pwd.hint':          'Минимум 4 символа',
      'pwd.connect':       'Подключиться',
      'pwd.remember':      'Запомнить на этом устройстве',

      // ── Chat ─────────────────────────────────────────────────────────────
      'chat.placeholder':  'Сообщение…',
      'chat.send':         'Отправить',
      'chat.waiting':      'Ожидание собеседника…',
      'chat.encrypted':    'Сообщения шифруются на устройстве',
      'chat.connecting':   'Подключение…',
      'chat.reconnecting': 'Переподключение…',
      'chat.call':         'Позвонить',
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
      'chat.reply':        'Ответить',
      'chat.copy_msg':     'Копировать',
      'chat.delete_msg':   'Удалить',
      'chat.file_attach':  'Прикрепить файл',
      'chat.invite':       'Пригласить',
      'chat.leave':        'Покинуть сессию',
      'chat.security':     'Безопасность сессии',
      'chat.search':       'Поиск',
      'chat.online':       'онлайн',
      'chat.offline':      'не в сети',

      // ── Common ────────────────────────────────────────────────────────────
      'common.cancel':     'Отмена',
      'common.close':      'Закрыть',
      'common.done':       'Готово',
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

      // ── Created ───────────────────────────────────────────────────────────
      'created.title':     'Session created',
      'created.share':     'Share this phrase with your contact',
      'created.copy':      'Copy',
      'created.copied':    'Copied',
      'created.qr':        'QR Code',
      'created.waiting':   'Waiting for contact…',
      'created.connected': 'Contact connected',

      // ── Join ──────────────────────────────────────────────────────────────
      'join.title':        'Join',
      'join.placeholder':  'Enter session phrase or hash',
      'join.find':         'Find session',
      'join.enter_phrase': 'enter phrase',
      'join.back':         'Back',
      'join.connect':      'Connect',
      'join.create_instead': 'Create a new session',
      'join.no_session':   'No active session with this phrase.',
      'join.suggest_create': 'You can create a new one and share the link.',
      'join.slots':        'Participants',
      'join.online':       'Online now',
      'join.free':         'Free slots',
      'join.created':      'Created',
      'join.expires':      'Expires in',
      'join.full':         'Session is full',
      'join.paired':       'Session is taken',

      // ── Password ──────────────────────────────────────────────────────────
      'pwd.title':         'Session password',
      'pwd.placeholder':   'Password (optional)',
      'pwd.hint':          'At least 4 characters',
      'pwd.connect':       'Connect',
      'pwd.remember':      'Remember on this device',

      // ── Chat ─────────────────────────────────────────────────────────────
      'chat.placeholder':  'Message…',
      'chat.send':         'Send',
      'chat.waiting':      'Waiting for contact…',
      'chat.encrypted':    'Messages are encrypted on device',
      'chat.connecting':   'Connecting…',
      'chat.reconnecting': 'Reconnecting…',
      'chat.call':         'Call',
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
      'chat.reply':        'Reply',
      'chat.copy_msg':     'Copy',
      'chat.delete_msg':   'Delete',
      'chat.file_attach':  'Attach file',
      'chat.invite':       'Invite',
      'chat.leave':        'Leave session',
      'chat.security':     'Session security',
      'chat.search':       'Search',
      'chat.online':       'online',
      'chat.offline':      'offline',

      // ── Common ────────────────────────────────────────────────────────────
      'common.cancel':     'Cancel',
      'common.close':      'Close',
      'common.done':       'Done',
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

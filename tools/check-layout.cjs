/* Проверка раскладки в настоящем браузере (headless Chrome/Edge).
   Запуск: node tools/check-layout.cjs [http://127.0.0.1:5173]

   Как работает: для каждого случая берётся копия реальной страницы,
   в неё на лету добавляется tools/measure.js, страница отдаётся Chrome
   через file:// с нужной шириной окна, а результат измерений печатается
   в DOM тегом <pre id="measure-out"> и читается через --dump-dom.
   Так мы видим фактические размеры, а не догадки. */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const base = process.argv[2] || 'http://127.0.0.1:5173';
const tmp = path.join(process.env.TEMP || '/tmp', 'cat-layout');

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const browser = findBrowser();
if (!browser) {
  console.error('Не найден Chrome/Edge. Укажите путь в переменной CHROME_PATH.');
  process.exit(2);
}

const CART_SEED = JSON.stringify([
  { id: 'g-01', qty: 1 }, { id: 'a-01', qty: 2 }, { id: 'c-04', qty: 1 }
]);

const cases = [
  { page: 'index.html', width: 1280, height: 1000, label: 'главная / десктоп 1280' },
  { page: 'catalog.html', width: 1280, height: 1000, label: 'каталог / десктоп 1280' },
  { page: 'product.html?id=k-01', width: 1280, height: 1000, label: 'товар / десктоп 1280' },
  { page: 'cart.html', width: 1280, height: 1000, label: 'корзина (3 позиции) / десктоп 1280', cart: CART_SEED },
  { page: 'cart.html', width: 1280, height: 1000, label: 'корзина (пустая) / десктоп 1280', cart: '[]' },
  { page: 'admin.html', width: 1280, height: 1000, label: 'админка / десктоп 1280' },
  { page: 'index.html', width: 390, height: 1200, label: 'главная / телефон 390' },
  { page: 'catalog.html', width: 390, height: 1200, label: 'каталог / телефон 390' },
  { page: 'product.html?id=a-01', width: 390, height: 1200, label: 'товар / телефон 390' },
  { page: 'cart.html', width: 390, height: 1200, label: 'корзина (3 позиции) / телефон 390', cart: CART_SEED },
  { page: 'admin.html', width: 390, height: 1200, label: 'админка / телефон 390' }
];

fs.mkdirSync(tmp, { recursive: true });
const profile = path.join(tmp, 'profile');
let failures = 0;

console.log('Браузер: ' + browser);
console.log('Сервер:  ' + base + '\n');

for (const c of cases) {
  const [pagePath, query] = c.page.split('?');
  const cartParam = c.cart ? '&cart=' + encodeURIComponent(c.cart) : '';
  const url = base + '/' + pagePath + '?measure=1' + cartParam + (query ? '&' + query : '');

  // Копию страницы не создаём: measure.js подключается через отдельный
  // параметр, который понимает только тестовый сервер (см. tools/serve.cjs).
  const res = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=8000',
    '--window-size=' + c.width + ',' + c.height,
    '--dump-dom', url
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });

  const dom = (res.stdout || '') + (res.stderr || '');
  const m = dom.match(/RESULT_JSON:(\{[\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('✗ ' + c.label + ' — не удалось измерить');
    console.log('    (страница не отдала результат; проверьте, что сервер запущен с поддержкой ?measure=1)\n');
    failures++;
    continue;
  }

  let r;
  try {
    r = JSON.parse(m[1]
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));
  } catch (e) {
    console.log('✗ ' + c.label + ' — не разобрать результат: ' + e.message + '\n');
    failures++;
    continue;
  }

  const problems = [];
  if (r.overflow && r.overflow.length) {
    problems.push('переполнение по горизонтали (' + r.scrollWidth + ' > ' + r.clientWidth + '): ' +
      r.overflow.map((o) => o.tag + '.' + o.cls + ' [' + o.left + '…' + o.right + '] «' + o.text + '»').join('; '));
  }
  if (r.brokenImages && r.brokenImages.length) problems.push('битые изображения: ' + r.brokenImages.join(', '));
  if (r.emptyBlocks && r.emptyBlocks.length) problems.push('пустые блоки: ' + r.emptyBlocks.join('; '));
  if (r.clippedButtons && r.clippedButtons.length) problems.push('обрезанный текст: ' + r.clippedButtons.join(' | '));

  if (problems.length) {
    failures++;
    console.log('✗ ' + c.label);
    problems.forEach((p) => console.log('    ' + p));
  } else {
    console.log('✓ ' + c.label);
  }
  console.log('    ' + (r.ok || []).join(' · ') + '\n');
}

console.log(failures ? 'Проблемных случаев: ' + failures : 'Все проверки раскладки пройдены');
process.exit(failures ? 1 : 0);
/* Проверка ОПУБЛИКОВАННОГО сайта (GitHub Pages или любой другой хостинг).

   Запуск: node tools/live-test.cjs [https://dimgo66.github.io/happy-cat-shop]

   Открывает страницы в headless Chrome и читает уже отрисованный DOM
   (--dump-dom выполняет JavaScript). Так проверяется, что на хостинге
   действительно работают витрина, каталог, корзина и админка — а не просто
   что файлы отдаются с кодом 200. */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || 'https://dimgo66.github.io/happy-cat-shop').replace(/\/$/, '');

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

let passed = 0, failed = 0;
function check(label, condition, extra) {
  if (condition) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? ' → ' + extra : '')); }
}

function dump(url, budget) {
  const profile = path.join(process.env.TEMP || '/tmp', 'cat-live-' + Date.now() + '-' + process.pid);
  try {
    const res = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile,
      '--virtual-time-budget=' + (budget || 8000),
      '--window-size=1280,1000',
      '--dump-dom', url
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    return (res.stdout || '') + (res.stderr || '');
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* профиль занят */ }
  }
}

const countMatches = (html, re) => (html.match(re) || []).length;

console.log('Проверка опубликованного сайта: ' + base + '\n');

console.log('[1] Главная страница');
{
  const html = dump(base + '/index.html');
  check('страница отрисовалась', /<body/.test(html));
  check('категории появились (скрипт сработал)',
    countMatches(html, /class="cat-card"/g) === 6, countMatches(html, /class="cat-card"/g));
  check('подборка хитов заполнена',
    countMatches(html, /id="featured-grid"[\s\S]*?<\/section>/g) > 0 &&
    countMatches(html, /class="card"/g) >= 4, countMatches(html, /class="card"/g));
  check('контакты подставлены из настроек',
    /Мурлыкина/.test(html));
  check('название магазина на месте', /Счастливый котик/.test(html));
}

console.log('\n[2] Каталог');
{
  const html = dump(base + '/catalog.html');
  const cards = countMatches(html, /data-product-card=/g);
  check('товары отрисованы из catalog.js', cards >= 20, cards + ' карточек');
  check('фильтры категорий построены',
    countMatches(html, /class="chip(?: is-active)?"/g) === 7,
    countMatches(html, /class="chip(?: is-active)?"/g));
  check('цены показаны', /\d[\d\s\u00a0]*₽/.test(html));
  check('картинки товаров подключены', /assets\/img\/products\/[a-z0-9-]+\.(jpg|webp|svg)/.test(html));
}

console.log('\n[3] Страница товара');
{
  const html = dump(base + '/product.html?id=g-01');
  check('товар найден и отрисован', /class="product-price"/.test(html));
  check('характеристики выведены', /class="spec-list"/.test(html));
  check('ошибки «товар не найден» нет', !/Товар не найден/.test(html));
}

console.log('\n[4] Корзина');
{
  const html = dump(base + '/cart.html');
  check('корзина отрисовалась', /Корзина/.test(html));
  check('пустое состояние показано', /Корзина пуста/.test(html));
  check('форма заказа на месте', /id="checkout-form"/.test(html));
}

console.log('\n[5] Админка (режим без сервера)');
{
  const html = dump(base + '/admin.html', 9000);
  check('админка открылась', /Управление магазином/.test(html));
  const rows = countMatches(html, /data-index=/g);
  check('таблица товаров заполнена', rows >= 20, rows + ' строк');
  check('поля настроек магазина есть', countMatches(html, /data-shop=/g) >= 9,
    countMatches(html, /data-shop=/g));
  check('категории отрисованы', countMatches(html, /data-cat-row=/g) === 6,
    countMatches(html, /data-cat-row=/g));
  check('определён режим сохранения в браузере (сервера на хостинге нет)',
    /браузер: локальные правки/.test(html),
    (/badge-state[^>]*>([^<]*)</.exec(html) || [])[1] || 'не найдено');
  check('показано объяснение про локальные правки',
    /режиме локальных правок/.test(html));
}

console.log('\n[6] Нужные файлы отдаются');
{
  const need = [
    '/assets/img/products/g-01.jpg',
    '/assets/img/favicon.svg',
    '/assets/js/data-override.js'
  ];
  let allOk = true;
  need.forEach((route) => {
    const profile = path.join(process.env.TEMP || '/tmp', 'cat-live-head-' + Date.now() + '-' + process.pid);
    const res = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--user-data-dir=' + profile,
      '--dump-dom', base + route
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
    const body = (res.stdout || '') + (res.stderr || '');
    if (/404|Not Found/i.test(body) && body.length < 2000) allOk = false;
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* занят */ }
  });
  check('картинки и скрипты витрины доступны', allOk);
}

console.log('\nИтог: ' + passed + ' успешно, ' + failed + ' провалено');
process.exit(failed ? 1 : 0);
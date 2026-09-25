/* ==========================================================================
   Счастливый котик — локальный сервер.

   Запуск:            node tools/serve.cjs [порт]        (по умолчанию 5173)
   Только просмотр:   node tools/serve.cjs 5173 --read-only

   Что умеет:
   • отдаёт файлы магазина (как обычный статический хостинг);
   • ?measure=1 — подключает tools/measure.js для проверки раскладки;
   • API для админки (admin.html):
       GET  /api/health      — доступна ли запись на диск
       POST /api/save-data   — сохранить каталог в assets/js/catalog.js
       POST /api/save-image  — загрузить картинку товара
       GET  /api/backups     — список резервных копий
       POST /api/restore     — откатиться на резервную копию
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const readOnly = process.argv.includes('--read-only');
const portArg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const port = Number(portArg) || 5173;

const CATALOG_FILE = path.join(root, 'assets/js/catalog.js');
const IMAGE_DIR = path.join(root, 'assets/img/products');
const BACKUP_DIR = path.join(root, '.backups');
const MAX_BACKUPS = 20;
const MAX_BODY = 6 * 1024 * 1024;          // 6 МБ на запрос
const MAX_IMAGE = 2 * 1024 * 1024;         // 2 МБ на картинку

const IMAGE_TYPES = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const DataSerialize = require('../assets/js/data-serialize.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/* ------------------------------ Утилиты ---------------------------------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Слишком большой запрос')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/* Создаёт резервную копию и возвращает её имя.
   Если за ту же секунду копия уже есть (два сохранения подряд), добавляем
   счётчик — иначе новая копия затёрла бы предыдущую, и откатываться было бы некуда. */
function makeBackup() {
  if (!fs.existsSync(CATALOG_FILE)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = 'catalog-' + timestamp();
  let name = stamp + '.js';
  let n = 2;
  while (fs.existsSync(path.join(BACKUP_DIR, name))) {
    name = stamp + '-' + n + '.js';
    n++;
  }

  fs.copyFileSync(CATALOG_FILE, path.join(BACKUP_DIR, name));

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^catalog-.*\.js$/.test(f))
    .sort();
  while (files.length > MAX_BACKUPS) {
    fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  }
  return name;
}

function countProducts() {
  try {
    const source = fs.readFileSync(CATALOG_FILE, 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source + '\n;this.n = PRODUCTS.length;', sandbox);
    return sandbox.n;
  } catch (e) { return null; }
}

/* ------------------------- Проверка данных ------------------------------- */

function sanitizeText(value, max) {
  return String(value == null ? '' : value).slice(0, max || 500);
}

function sanitizeNumber(value, fallback) {
  const n = Number(value);
  return isFinite(n) ? n : fallback;
}

/* Приводит присланные данные к известному набору полей и проверяет обязательные. */
function validateData(input) {
  if (!input || typeof input !== 'object') throw new Error('Нет данных для сохранения');
  const shop = input.shop || {};
  const categories = Array.isArray(input.categories) ? input.categories : [];
  const products = Array.isArray(input.products) ? input.products : [];

  if (!categories.length) throw new Error('Нужна хотя бы одна категория');
  if (!products.length) throw new Error('Нужен хотя бы один товар');

  const catIds = new Set();
  const cleanCategories = categories.map((c, i) => {
    const id = sanitizeText(c && c.id, 40).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Категория №' + (i + 1) + ': неверный id (латиница, цифры, - и _)');
    if (catIds.has(id)) throw new Error('Категория «' + id + '» повторяется');
    catIds.add(id);
    return {
      id: id,
      name: sanitizeText(c.name, 80).trim() || id,
      icon: sanitizeText(c.icon, 8) || '🎵',
      short: sanitizeText(c.short, 200)
    };
  });

  const prodIds = new Set();
  const cleanProducts = products.map((p, i) => {
    const id = sanitizeText(p && p.id, 40).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Товар №' + (i + 1) + ': неверный id (латиница, цифры, - и _)');
    if (prodIds.has(id)) throw new Error('Товар с id «' + id + '» повторяется');
    prodIds.add(id);

    const title = sanitizeText(p.title, 200).trim();
    if (!title) throw new Error('Товар «' + id + '»: не заполнено название');

    const category = sanitizeText(p.category, 40);
    if (!catIds.has(category)) throw new Error('Товар «' + title + '»: категория «' + category + '» не найдена');

    const price = sanitizeNumber(p.price, NaN);
    if (!isFinite(price) || price < 0) throw new Error('Товар «' + title + '»: некорректная цена');

    const item = {
      id: id,
      title: title,
      category: category,
      price: Math.round(price),
      rating: Math.min(5, Math.max(0, sanitizeNumber(p.rating, 5))),
      reviews: Math.max(0, Math.round(sanitizeNumber(p.reviews, 0))),
      stock: Math.max(0, Math.round(sanitizeNumber(p.stock, 0))),
      desc: sanitizeText(p.desc, 600),
      specs: (Array.isArray(p.specs) ? p.specs : [])
        .map((s) => sanitizeText(s, 200).trim())
        .filter(Boolean)
        .slice(0, 30)
    };

    if (p.oldPrice !== undefined && p.oldPrice !== null && p.oldPrice !== '') {
      const oldPrice = sanitizeNumber(p.oldPrice, NaN);
      if (isFinite(oldPrice) && oldPrice > 0) item.oldPrice = Math.round(oldPrice);
    }
    if (p.badge) item.badge = sanitizeText(p.badge, 20);
    if (p.image) item.image = sanitizeText(p.image, 120);

    return item;
  });

  const cleanShop = {
    name: sanitizeText(shop.name, 80).trim() || 'Магазин',
    tagline: sanitizeText(shop.tagline, 120),
    phone: sanitizeText(shop.phone, 40),
    email: sanitizeText(shop.email, 80),
    address: sanitizeText(shop.address, 160),
    hours: sanitizeText(shop.hours, 80),
    freeShippingFrom: Math.max(0, Math.round(sanitizeNumber(shop.freeShippingFrom, 0))),
    shippingCost: Math.max(0, Math.round(sanitizeNumber(shop.shippingCost, 0))),
    pickupDiscount: Math.max(0, Math.round(sanitizeNumber(shop.pickupDiscount, 0)))
  };

  return { shop: cleanShop, categories: cleanCategories, products: cleanProducts };
}

/* ------------------------------ API -------------------------------------- */

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/health') {
    let writable = false;
    try {
      fs.accessSync(path.dirname(CATALOG_FILE), fs.constants.W_OK);
      writable = true;
    } catch (e) { writable = false; }
    return sendJson(res, 200, {
      ok: true,
      readOnly: readOnly,
      writable: writable && !readOnly,
      catalog: 'assets/js/catalog.js',
      products: countProducts()
    });
  }

  if (route === '/api/backups' && req.method === 'GET') {
    if (!fs.existsSync(BACKUP_DIR)) return sendJson(res, 200, { ok: true, backups: [] });
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^catalog-.*\.js$/.test(f))
      .sort()
      .reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
    return sendJson(res, 200, { ok: true, backups: backups });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Метод не поддерживается' });
  }

  if (readOnly) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Сервер запущен в режиме только для чтения (--read-only). Перезапустите без этого флага.'
    });
  }

  let payload;
  try { payload = await readBody(req); }
  catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }

  if (route === '/api/save-data') {
    let data;
    try { data = validateData(payload.data); }
    catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }

    const text = DataSerialize.serialize({
      shop: data.shop,
      categories: data.categories,
      products: data.products,
      updated: new Date().toLocaleString('ru-RU')
    });

    // Проверяем, что получившийся файл вообще исполняется и ничего не потерял.
    try {
      const sandbox = {};
      vm.createContext(sandbox);
      vm.runInContext(text + '\n;this.PRODUCTS = PRODUCTS; this.CATEGORIES = CATEGORIES; this.SHOP = SHOP;', sandbox);
      if (sandbox.PRODUCTS.length !== data.products.length) {
        throw new Error('после сборки потерялись товары');
      }
      if (sandbox.CATEGORIES.length !== data.categories.length) {
        throw new Error('после сборки потерялись категории');
      }
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'Не удалось собрать файл: ' + e.message });
    }

    let backup = null;
    try {
      backup = makeBackup();
      const tmpFile = CATALOG_FILE + '.tmp';
      fs.writeFileSync(tmpFile, text, 'utf8');
      fs.renameSync(tmpFile, CATALOG_FILE);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'Не удалось записать файл: ' + e.message });
    }

    return sendJson(res, 200, {
      ok: true,
      bytes: Buffer.byteLength(text),
      backup: backup,
      products: data.products.length,
      categories: data.categories.length,
      savedAt: new Date().toISOString()
    });
  }

  if (route === '/api/save-image') {
    const id = String(payload.id || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return sendJson(res, 400, { ok: false, error: 'Неверный id товара' });
    }
    const dataUrl = String(payload.dataUrl || '');
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return sendJson(res, 400, { ok: false, error: 'Ожидается картинка в формате data:URL' });

    const mime = m[1].toLowerCase();
    const ext = IMAGE_TYPES[mime];
    if (!ext) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Неподдерживаемый формат: ' + mime + '. Можно SVG, PNG, JPEG, WebP или GIF.'
      });
    }

    let buffer;
    try { buffer = Buffer.from(m[2], 'base64'); }
    catch (e) { return sendJson(res, 400, { ok: false, error: 'Повреждённые данные картинки' }); }
    if (!buffer.length) return sendJson(res, 400, { ok: false, error: 'Пустой файл' });
    if (buffer.length > MAX_IMAGE) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Файл больше 2 МБ (' + Math.round(buffer.length / 1024) + ' КБ). Сожмите картинку.'
      });
    }

    try {
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(IMAGE_DIR, id + ext), buffer);
      Object.keys(IMAGE_TYPES).forEach((t) => {
        const other = IMAGE_TYPES[t];
        if (other === ext) return;
        const p = path.join(IMAGE_DIR, id + other);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'Не удалось сохранить картинку: ' + e.message });
    }

    return sendJson(res, 200, {
      ok: true,
      file: 'assets/img/products/' + id + ext,
      bytes: buffer.length
    });
  }

  if (route === '/api/restore') {
    const name = String(payload.name || '');
    if (!/^catalog-[\d-]+\.js$/.test(name)) {
      return sendJson(res, 400, { ok: false, error: 'Неверное имя резервной копии' });
    }
    const source = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(source)) return sendJson(res, 404, { ok: false, error: 'Копия не найдена' });

    try {
      makeBackup();
      fs.copyFileSync(source, CATALOG_FILE);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'Не удалось восстановить: ' + e.message });
    }
    return sendJson(res, 200, { ok: true, restored: name });
  }

  return sendJson(res, 404, { ok: false, error: 'Неизвестный метод API' });
}

/* --------------------------- Статика ------------------------------------- */

function serveStatic(req, res, url) {
  const urlPath = decodeURIComponent(url.pathname);
  let file = path.join(root, urlPath);

  if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }

  // Служебные папки и файлы (например .backups) наружу не отдаём.
  const relative = path.relative(root, file);
  if (relative.split(path.sep).some((part) => part.startsWith('.'))) {
    res.writeHead(404); res.end('not found'); return;
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 — страница не найдена</h1><p><a href="/">На главную</a></p>');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  let body = fs.readFileSync(file);

  // Служебный режим для проверки раскладки: ?measure=1
  if (ext === '.html' && url.searchParams.get('measure') === '1') {
    const seed = url.searchParams.get('cart');
    let inject = '';
    if (seed) {
      inject += '<script>try{localStorage.setItem("happycat_cart_v1",' +
        JSON.stringify(seed) + ');}catch(e){}</script>';
    }
    inject += '<script src="/tools/measure.js"></script>';
    body = Buffer.from(body.toString('utf8').replace('</body>', inject + '\n</body>'), 'utf8');
  }

  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

/* ----------------------------- Запуск ------------------------------------ */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      sendJson(res, 500, { ok: false, error: 'Внутренняя ошибка: ' + e.message });
    });
    return;
  }
  try { serveStatic(req, res, url); }
  catch (e) { res.writeHead(500); res.end('Ошибка сервера: ' + e.message); }
});

if (require.main === module) {
  server.listen(port, '127.0.0.1', () => {
    console.log('🐱 «Счастливый котик» — http://127.0.0.1:' + port);
    console.log('   Витрина: http://127.0.0.1:' + port + '/index.html');
    console.log('   Админка: http://127.0.0.1:' + port + '/admin.html');
    console.log('   Режим:   ' + (readOnly
      ? 'только чтение — сохранение отключено'
      : 'с сохранением в assets/js/catalog.js'));
    console.log('   Остановить — Ctrl+C');
  });
}

module.exports = { server, validateData };
/* Проверка админки и сохранения данных.

   Запуск: node tools/admin-test.cjs

   Что делает (настоящие HTTP-запросы к поднятому серверу):
   1. проверяет /api/health;
   2. сохраняет изменённую цену и новый товар, затем читает
      assets/js/catalog.js из файловой системы и убеждается, что данные там;
   3. проверяет, что резервная копия создана и откат работает;
   4. проверяет, что сервер отвергает мусор (дубли id, пустое название,
      чужую категорию, отрицательную цену);
   5. проверяет загрузку картинки и отклонение неподдерживаемого формата.

   В конце файл catalog.js возвращается к исходному состоянию. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const CATALOG = path.join(root, 'assets/js/catalog.js');
const BACKUP_DIR = path.join(root, '.backups');
const PORT = 8791;

process.env.CATALOG_FILE = CATALOG;

let passed = 0, failed = 0;
function check(label, condition, extra) {
  if (condition) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? ' → ' + extra : '')); }
}

function loadCatalog() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(CATALOG, 'utf8') +
    '\n;this.PRODUCTS = PRODUCTS; this.CATEGORIES = CATEGORIES; this.SHOP = SHOP;',
    sandbox
  );
  return { products: sandbox.PRODUCTS, categories: sandbox.CATEGORIES, shop: sandbox.SHOP };
}

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method: method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {}
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { json = { _raw: raw }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async function run() {
  const originalText = fs.readFileSync(CATALOG, 'utf8');
  const original = loadCatalog();

  const { server } = require('./serve.cjs');
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

  try {
    console.log('\n[1] Доступность сервера и API');
    {
      const health = await request('GET', '/api/health');
      check('health отвечает ok', health.status === 200 && health.body.ok === true);
      check('запись разрешена', health.body.writable === true, JSON.stringify(health.body));
      check('сервер видит ' + original.products.length + ' товаров',
        health.body.products === original.products.length, String(health.body.products));
    }

    console.log('\n[2] Сохранение каталога в файл');
    let savedProducts = null;
    {
      const changed = JSON.parse(JSON.stringify({
        shop: original.shop,
        categories: original.categories,
        products: original.products
      }));

      // меняем цену первого товара и добавляем новый
      const targetId = changed.products[0].id;
      changed.products[0].price = 12345;
      changed.products[0].stock = 0;
      changed.shop.phone = '+7 (999) 111-22-33';
      changed.products.push({
        id: 'test-new-1',
        title: 'Тестовый товар «Проверка»',
        category: changed.categories[0].id,
        price: 777,
        rating: 4.2,
        reviews: 3,
        stock: 5,
        desc: 'Создан автотестом',
        specs: ['Пункт A', 'Пункт B']
      });

      const res = await request('POST', '/api/save-data', { data: changed });
      check('сохранение прошло', res.status === 200 && res.body.ok === true, JSON.stringify(res.body));
      check('создана резервная копия', !!res.body.backup, String(res.body.backup));

      const onDisk = loadCatalog();
      savedProducts = onDisk.products;

      const updated = onDisk.products.find((p) => p.id === targetId);
      check('цена записана в файл (12 345 ₽)', updated && updated.price === 12345,
        updated ? String(updated.price) : 'товар не найден');
      check('остаток записан в файл (0)', updated && updated.stock === 0);
      check('новый товар появился в файле',
        !!onDisk.products.find((p) => p.id === 'test-new-1'));
      check('новый товар сохранил характеристики',
        (onDisk.products.find((p) => p.id === 'test-new-1') || {}).specs.length === 2);
      check('стало на 1 товар больше',
        onDisk.products.length === original.products.length + 1,
        String(onDisk.products.length));
      check('телефон в настройках обновлён',
        onDisk.shop.phone === '+7 (999) 111-22-33', onDisk.shop.phone);
      check('категории не потерялись',
        onDisk.categories.length === original.categories.length);
      check('файл остаётся валидным JS', (() => {
        try { loadCatalog(); return true; } catch (e) { return false; }
      })());
      check('в файле есть отметка об обновлении', /Обновлено:/.test(fs.readFileSync(CATALOG, 'utf8')));
    }

    console.log('\n[3] Резервные копии и откат');
    {
      const list = await request('GET', '/api/backups');
      check('список копий не пуст', list.status === 200 && list.body.backups.length >= 1,
        String(list.body.backups && list.body.backups.length));

      const newest = list.body.backups[0].name;
      check('имя копии в ожидаемом формате', /^catalog-\d{8}-\d{6}\.js$/.test(newest), newest);

      const restore = await request('POST', '/api/restore', { name: newest });
      check('откат выполнен', restore.status === 200 && restore.body.ok === true,
        JSON.stringify(restore.body));

      const after = loadCatalog();
      check('после отката товаров снова ' + original.products.length,
        after.products.length === original.products.length, String(after.products.length));
      check('после отката цена вернулась к ' + original.products[0].price,
        after.products[0].price === original.products[0].price,
        String(after.products[0].price));
    }

    console.log('\n[4] Проверка некорректных данных');
    {
      const base = {
        shop: original.shop,
        categories: original.categories,
        products: original.products
      };
      const send = (mutate) => {
        const copy = JSON.parse(JSON.stringify(base));
        mutate(copy);
        return request('POST', '/api/save-data', { data: copy });
      };

      const dup = await send((d) => { d.products[1].id = d.products[0].id; });
      check('дубликат id отвергнут', dup.status === 400 && /повторяется/.test(dup.body.error),
        dup.body.error);

      const noTitle = await send((d) => { d.products[0].title = ''; });
      check('пустое название отвергнуто', noTitle.status === 400 && /название/.test(noTitle.body.error),
        noTitle.body.error);

      const badCat = await send((d) => { d.products[0].category = 'не-существует'; });
      check('чужая категория отвергнута', badCat.status === 400 && /категория/.test(badCat.body.error),
        badCat.body.error);

      const badPrice = await send((d) => { d.products[0].price = -100; });
      check('отрицательная цена отвергнута', badPrice.status === 400 && /цена/.test(badPrice.body.error),
        badPrice.body.error);

      const badId = await send((d) => { d.products[0].id = 'кириллица'; });
      check('кириллический id отвергнут', badId.status === 400 && /id/.test(badId.body.error),
        badId.body.error);

      const noProducts = await send((d) => { d.products = []; });
      check('пустой каталог отвергнут', noProducts.status === 400, noProducts.body.error);

      const stillOk = loadCatalog();
      check('файл не пострадал от отклонённых запросов',
        stillOk.products.length === original.products.length, String(stillOk.products.length));
    }

    console.log('\n[5] Загрузка картинок');
    {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>';
      const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
      const res = await request('POST', '/api/save-image', { id: 'test-img-1', dataUrl: dataUrl });
      check('SVG принят', res.status === 200 && res.body.ok === true, JSON.stringify(res.body));
      check('файл картинки создан', fs.existsSync(path.join(root, 'assets/img/products/test-img-1.svg')));

      const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
      const res2 = await request('POST', '/api/save-image', { id: 'test-img-1', dataUrl: png });
      check('PNG заменяет прежний SVG', res2.status === 200 && /\.png$/.test(res2.body.file), res2.body.file);
      check('старый SVG того же товара удалён',
        !fs.existsSync(path.join(root, 'assets/img/products/test-img-1.svg')));

      const bad = await request('POST', '/api/save-image', {
        id: 'test-img-1', dataUrl: 'data:text/plain;base64,' + Buffer.from('hi').toString('base64')
      });
      check('текстовый формат отвергнут', bad.status === 400 && /формат/i.test(bad.body.error), bad.body.error);

      const badId = await request('POST', '/api/save-image', { id: 'плохой id', dataUrl: dataUrl });
      check('неверный id картинки отвергнут', badId.status === 400, badId.body.error);

      // уборка
      ['png', 'svg', 'jpg', 'webp', 'gif'].forEach((ext) => {
        const p = path.join(root, 'assets/img/products/test-img-1.' + ext);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      check('тестовые картинки удалены',
        !fs.existsSync(path.join(root, 'assets/img/products/test-img-1.png')));
    }

    console.log('\n[6] Витрина читает сохранённые данные');
    {
      const changed = JSON.parse(JSON.stringify({
        shop: original.shop, categories: original.categories, products: original.products
      }));
      changed.products[0].price = 55555;
      await request('POST', '/api/save-data', { data: changed });

      // сервер отдаёт catalog.js как статику — проверяем содержимое
      const served = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: '/assets/js/catalog.js' }, (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve(raw));
        }).on('error', reject);
      });
      check('витрина получает обновлённый catalog.js', /55555/.test(served));
      check('catalog.js отдаётся как JavaScript',
        served.indexOf('const PRODUCTS') !== -1);

      const html = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: '/index.html' }, (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve(raw));
        }).on('error', reject);
      });
      check('страница подключает catalog.js', /assets\/js\/catalog\.js/.test(html));
      check('страница подключает data-override.js', /assets\/js\/data-override\.js/.test(html));
      check('страница больше не ссылается на data.js', !/assets\/js\/data\.js/.test(html));
    }

    console.log('\n[7] Служебная папка закрыта снаружи');
    {
      const res = await request('GET', '/.backups/');
      check('папка .backups не отдаётся', res.status === 404, String(res.status));

      const admin = await new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: PORT, path: '/admin.html' }, (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve(raw));
        }).on('error', reject);
      });
      check('админка доступна', /Управление магазином/.test(admin));
      check('админка подключает admin.js', /assets\/js\/admin\.js/.test(admin));
    }
  } finally {
    // Возвращаем файл и убираем следы теста.
    fs.writeFileSync(CATALOG, originalText, 'utf8');
    const cleaned = loadCatalog();
    if (cleaned.products.length !== original.products.length) {
      console.log('  ВНИМАНИЕ: не удалось вернуть исходный catalog.js');
    }
    if (fs.existsSync(BACKUP_DIR)) {
      fs.readdirSync(BACKUP_DIR)
        .filter((f) => /^catalog-.*\.js$/.test(f))
        .forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
      fs.rmdirSync(BACKUP_DIR);
    }
    server.close();
  }

  const final = loadCatalog();
  console.log('\nФайл catalog.js восстановлен: ' + final.products.length + ' товаров');
  console.log('Итог: ' + passed + ' успешно, ' + failed + ' провалено');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
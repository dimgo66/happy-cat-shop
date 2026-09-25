/* Быстрая проверка сайта без браузера (jsdom).
   Запуск (PowerShell):
     $env:NODE_PATH="$env:TEMP\dsh-jsdom\node_modules"; node tools/smoke-test.cjs
   Тест поднимает локальный http-сервер и проверяет главную, каталог,
   страницу товара и оформление заказа. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serve(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let passed = 0, failed = 0;
function check(label, condition, extra) {
  if (condition) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (extra ? ' → ' + extra : '')); }
}

const clean = (s) => String(s).replace(/\s|\u00a0/g, '');

async function loadPage(port, page, seedCart) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not parse CSS/.test(e.message)) errors.push(e.message); });
  const dom = await JSDOM.fromURL(`http://127.0.0.1:${port}/${page}`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (seedCart) window.localStorage.setItem('happycat_cart_v1', JSON.stringify(seedCart));
    }
  });
  await new Promise((r) => setTimeout(r, 400));
  return { dom, errors };
}

(async function run() {
  const port = 8731;
  const server = await serve(port);

  console.log('\n[1] Главная страница');
  {
    const { dom, errors } = await loadPage(port, 'index.html');
    const d = dom.window.document;
    check('нет ошибок JS', errors.length === 0, errors.join('; '));
    check('6 карточек категорий', d.querySelectorAll('#category-cards .cat-card').length === 6);
    check('4 хита в подборке', d.querySelectorAll('#featured-grid .card').length === 4);
    check('счётчик корзины скрыт при пустой корзине',
      d.querySelector('[data-cart-count]').getAttribute('data-empty') === 'true');
    check('файл изображения товара существует',
      fs.existsSync(path.join(root, 'assets/img/products/g-01.svg')));
    check('контакты берутся из настроек магазина',
      d.querySelector('[data-shop-contact="phone"]').textContent.trim() === '+7 (900) 000-00-00',
      d.querySelector('[data-shop-contact="phone"]').textContent);
    check('адрес берётся из настроек',
      /Мурлыкина/.test(d.querySelector('[data-shop-contact="address"]').textContent));
    check('стоимость доставки подставлена из настроек',
      d.querySelector('[data-shop-contact="shippingCost"]').textContent.trim() === '390',
      d.querySelector('[data-shop-contact="shippingCost"]').textContent);
    dom.window.close();
  }

  console.log('\n[2] Каталог, фильтры и корзина');
  {
    const { dom, errors } = await loadPage(port, 'catalog.html');
    const d = dom.window.document;
    const w = dom.window;
    check('нет ошибок JS', errors.length === 0, errors.join('; '));
    check('23 товара в каталоге', d.querySelectorAll('#catalog-grid .card').length === 23);
    check('7 фильтров-категорий', d.querySelectorAll('#catalog-chips .chip').length === 7);

    const chip = (id) => Array.from(d.querySelectorAll('#catalog-chips .chip'))
      .find((c) => c.getAttribute('data-cat') === id);

    chip('art').dispatchEvent(new w.Event('click', { bubbles: true }));
    check('фильтр «Художественные товары» даёт 5 товаров',
      d.querySelectorAll('#catalog-grid .card').length === 5,
      String(d.querySelectorAll('#catalog-grid .card').length));

    chip('all').dispatchEvent(new w.Event('click', { bubbles: true }));
    check('сброс фильтра возвращает 23 товара', d.querySelectorAll('#catalog-grid .card').length === 23);

    const search = d.querySelector('#catalog-search');
    search.value = 'микрофон';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    check('поиск «микрофон» находит 1 товар', d.querySelectorAll('#catalog-grid .card').length === 1,
      String(d.querySelectorAll('#catalog-grid .card').length));
    search.value = '';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    check('кнопка «В корзину» у всех карточек', d.querySelectorAll('#catalog-grid [data-add]').length === 23);

    const sort = d.querySelector('#catalog-sort');
    sort.value = 'cheap';
    sort.dispatchEvent(new w.Event('change', { bubbles: true }));
    check('сортировка по цене: первым самый дешёвый (990 ₽)',
      clean(d.querySelector('#catalog-grid .card__price').textContent) === '990₽',
      clean(d.querySelector('#catalog-grid .card__price').textContent));

    d.querySelector('#catalog-grid [data-add]').dispatchEvent(new w.Event('click', { bubbles: true }));
    const stored = JSON.parse(w.localStorage.getItem('happycat_cart_v1') || '[]');
    check('товар попал в localStorage', stored.length === 1 && stored[0].qty === 1, JSON.stringify(stored));
    check('счётчик корзины показывает 1', d.querySelector('[data-cart-count]').textContent === '1');
    dom.window.close();
  }

  console.log('\n[3] Страница товара');
  {
    const { dom, errors } = await loadPage(port, 'product.html?id=k-01');
    const d = dom.window.document;
    check('нет ошибок JS', errors.length === 0, errors.join('; '));
    check('название товара отрисовано', /Purrmaster/.test(d.querySelector('#product-page h1').textContent));
    check('цена отрисована', /27\s?900/.test(d.querySelector('.product-price').textContent));
    check('характеристики: 4 пункта', d.querySelectorAll('.spec-list li').length === 4);

    d.querySelector('[data-qty-plus]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    check('кнопка «+» увеличивает количество',
      d.querySelector('#product-qty').value === '2', d.querySelector('#product-qty').value);
    d.querySelector('#product-add').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const stored = JSON.parse(dom.window.localStorage.getItem('happycat_cart_v1') || '[]');
    check('в корзину добавлено 2 шт.', stored.length === 1 && stored[0].qty === 2, JSON.stringify(stored));
    dom.window.close();
  }

  console.log('\n[4] Корзина: суммы, доставка, валидация, заказ');
  {
    const { dom, errors } = await loadPage(port, 'cart.html', [
      { id: 'g-01', qty: 1 },
      { id: 'a-01', qty: 2 }
    ]);
    const d = dom.window.document;
    const w = dom.window;
    check('нет ошибок JS', errors.length === 0, errors.join('; '));
    check('2 позиции в корзине', d.querySelectorAll('#cart-items .cart-item').length === 2);
    check('сумма товаров = 20 700 ₽', clean(d.querySelector('#sum-items').textContent) === '20700₽',
      d.querySelector('#sum-items').textContent);
    check('при заказе от 5 000 ₽ доставка бесплатна',
      clean(d.querySelector('#sum-delivery').textContent) === 'бесплатно',
      d.querySelector('#sum-delivery').textContent);
    check('итого = 20 700 ₽', clean(d.querySelector('#sum-total').textContent) === '20700₽',
      d.querySelector('#sum-total').textContent);

    d.querySelector('#cart-items [data-item="a-01"] [data-inc]')
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    check('кнопка «+» пересчитывает сумму (3 × 2 900 + 14 900 = 23 600 ₽)',
      clean(d.querySelector('#sum-items').textContent) === '23600₽',
      d.querySelector('#sum-items').textContent);

    d.querySelector('#cart-items [data-item="g-01"] [data-remove]')
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    check('после удаления осталась 1 позиция', d.querySelectorAll('#cart-items .cart-item').length === 1);
    check('остались акриловые краски', !!d.querySelector('#cart-items [data-item="a-01"]'));
    check('сумма после удаления = 8 700 ₽ (3 × 2 900 ₽)',
      clean(d.querySelector('#sum-items').textContent) === '8700₽',
      d.querySelector('#sum-items').textContent);

    // платная доставка и самовывоз на дешёвом заказе
    const { dom: dom2 } = await loadPage(port, 'cart.html', [{ id: 'a-04', qty: 1 }]);
    const d2 = dom2.window.document;
    check('заказ на 990 ₽: доставка 390 ₽',
      clean(d2.querySelector('#sum-delivery').textContent) === '390₽',
      d2.querySelector('#sum-delivery').textContent);
    check('заказ на 990 ₽: итого 1 380 ₽',
      clean(d2.querySelector('#sum-total').textContent) === '1380₽',
      d2.querySelector('#sum-total').textContent);
    const pickup = d2.querySelector('input[name="delivery"][value="pickup"]');
    pickup.checked = true;
    pickup.dispatchEvent(new dom2.window.Event('change', { bubbles: true }));
    check('самовывоз: доставка бесплатна',
      /бесплатно/.test(d2.querySelector('#sum-delivery').textContent),
      d2.querySelector('#sum-delivery').textContent);
    check('самовывоз: итого 990 ₽ без доставки',
      clean(d2.querySelector('#sum-total').textContent) === '990₽',
      d2.querySelector('#sum-total').textContent);
    dom2.window.close();

    // пустая корзина
    const { dom: dom3 } = await loadPage(port, 'cart.html');
    check('пустая корзина: заглушка вместо списка',
      /Корзина пуста/.test(dom3.window.document.querySelector('#cart-items').textContent));
    check('пустая корзина: блок оформления скрыт',
      dom3.window.document.querySelector('#cart-summary').hidden === true);
    dom3.window.close();

    // оформление заказа
    const form = d.querySelector('#checkout-form');
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    check('валидация не пускает пустую форму',
      d.querySelectorAll('#checkout-form .field.is-invalid').length >= 2);
    check('заказ не оформлен', d.querySelector('#order-success').hidden === true);

    d.querySelector('[name="name"]').value = 'Анна Котова';
    d.querySelector('[name="phone"]').value = '+7 900 123-45-67';
    d.querySelector('[name="address"]').value = 'Москва, ул. Мурлыкина, 7, кв. 1';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));

    const success = d.querySelector('#order-success');
    check('экран успеха показан', success.hidden === false);
    check('номер заказа вида СК-ГГММДД-NNNN',
      /СК-\d{6}-\d{4}/.test(success.querySelector('.order-number').textContent),
      success.querySelector('.order-number').textContent);
    check('в заказе указан получатель', /Анна Котова/.test(success.textContent));
    check('в заказе перечислены товары', /акриловых красок/.test(success.textContent));
    check('в заказе верная сумма 8 700 ₽ без платной доставки',
      /8\s?700/.test(success.textContent) && !/390/.test(success.textContent));
    check('корзина очищена после заказа',
      d.querySelector('[data-cart-count]').textContent === '0',
      d.querySelector('[data-cart-count]').textContent);
    dom.window.close();
  }

  server.close();
  console.log('\nИтог: ' + passed + ' успешно, ' + failed + ' провалено');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
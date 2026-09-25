/* ==========================================================================
   Счастливый котик — логика магазина
   Корзина хранится в localStorage браузера, сервер не нужен.
   ========================================================================== */

(function () {
  'use strict';

  var CART_KEY = 'happycat_cart_v1';
  var ORDER_KEY = 'happycat_last_order_v1';

  /* ----------------------------- Утилиты --------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(value)) + ' ₽';
  }

  function declOfNum(n, forms) {
    n = Math.abs(n) % 100;
    var n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function productById(id) {
    for (var i = 0; i < PRODUCTS.length; i++) {
      if (PRODUCTS[i].id === id) return PRODUCTS[i];
    }
    return null;
  }

  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) return CATEGORIES[i];
    }
    return null;
  }

  function categoryName(id) {
    var c = categoryById(id);
    return c ? c.name : 'Товары';
  }

  /* Картинка товара: своя (поле image) или сгенерированная заглушка <id>.svg */
  function productImage(product) {
    var id = typeof product === 'string' ? product : (product && product.id);
    var custom = typeof product === 'object' && product ? product.image : null;
    var src = custom || ('assets/img/products/' + id + '.svg');

    // Если у товара картинка своего формата, а её нет на диске —
    // подстраховываемся заглушкой, чтобы витрина не показывала битую иконку.
    return src;
  }

  function imageFallback(img) {
    img.addEventListener('error', function handler() {
      img.removeEventListener('error', handler);
      var fallback = 'assets/img/products/' + img.getAttribute('data-id') + '.svg';
      if (img.getAttribute('src') !== fallback) img.setAttribute('src', fallback);
    });
  }

  function stars(rating) {
    var full = Math.round(rating);
    var out = '';
    for (var i = 0; i < 5; i++) out += i < full ? '★' : '☆';
    return out;
  }

  /* ------------------------------ Toast ---------------------------------- */

  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2400);
  }

  /* ------------------------------ Корзина -------------------------------- */

  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (row) { return row && productById(row.id); })
        .map(function (row) { return { id: row.id, qty: Math.max(1, parseInt(row.qty, 10) || 1) }; });
    } catch (e) {
      return [];
    }
  }

  function writeCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) { /* приватный режим */ }
    updateCartBadge();
  }

  function cartCount() {
    return readCart().reduce(function (sum, row) { return sum + row.qty; }, 0);
  }

  function cartLines() {
    return readCart().map(function (row) {
      var p = productById(row.id);
      return { product: p, qty: row.qty, sum: p.price * row.qty };
    });
  }

  function cartSubtotal() {
    return cartLines().reduce(function (sum, line) { return sum + line.sum; }, 0);
  }

  function addToCart(id, qty) {
    var product = productById(id);
    if (!product) return;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    var cart = readCart();
    var found = null;
    for (var i = 0; i < cart.length; i++) if (cart[i].id === id) found = cart[i];
    var max = product.stock || 99;
    if (found) {
      found.qty = Math.min(max, found.qty + qty);
    } else {
      cart.push({ id: id, qty: Math.min(max, qty) });
    }
    writeCart(cart);
    toast('«' + product.title + '» — в корзине');
  }

  function setQty(id, qty) {
    qty = parseInt(qty, 10) || 1;
    var product = productById(id);
    var max = product && product.stock ? product.stock : 99;
    qty = Math.min(Math.max(1, qty), max);
    var cart = readCart();
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].id === id) cart[i].qty = qty;
    }
    writeCart(cart);
  }

  function removeFromCart(id) {
    writeCart(readCart().filter(function (row) { return row.id !== id; }));
  }

  function clearCart() { writeCart([]); }

  function updateCartBadge() {
    var count = cartCount();
    $$('[data-cart-count]').forEach(function (el) {
      el.textContent = count;
      el.setAttribute('data-empty', count === 0 ? 'true' : 'false');
    });
  }

  /* ---------------------- Данные магазина из настроек -------------------- */

  /* Контакты и цены в футере/контактах берём из SHOP, чтобы правки в админке
     были видны на витрине, а не только в файле. */
  function initShopInfo() {
    $$('[data-shop-contact]').forEach(function (el) {
      var key = el.getAttribute('data-shop-contact');
      var value = SHOP[key];
      if (value === undefined || value === null) return;
      el.textContent = typeof value === 'number' ? new Intl.NumberFormat('ru-RU').format(value) : value;
    });

    $$('[data-shop-name]').forEach(function (el) { el.textContent = SHOP.name; });
    if (document.body.getAttribute('data-page') === 'home') {
      document.title = SHOP.name + ' — ' + (SHOP.tagline || 'музыкальные и художественные товары');
    }
  }

  /* ------------------------------- Шапка --------------------------------- */

  function initHeader() {
    var burger = $('[data-burger]');
    var nav = $('#main-nav');
    if (burger && nav) {
      burger.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    var page = document.body.getAttribute('data-page');
    $$('.main-nav a[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === page) a.classList.add('is-active');
    });
    updateCartBadge();
  }

  /* ---------------------------- Карточка товара -------------------------- */

  function badgeFor(product) {
    if (!product.badge) return '';
    var cls = product.badge.toLowerCase() === 'новинка' ? 'card__badge--new' : 'card__badge--hit';
    return '<span class="card__badge ' + cls + '">' + esc(product.badge) + '</span>';
  }

  function cardHTML(product) {
    var priceOld = product.oldPrice
      ? ' <span class="card__old">' + money(product.oldPrice) + '</span>' : '';
    var soldOut = product.stock === 0;
    return '' +
      '<article class="card" data-product-card="' + esc(product.id) + '">' +
        '<a class="card__media" href="product.html?id=' + encodeURIComponent(product.id) + '" aria-label="' + esc(product.title) + '">' +
          badgeFor(product) +
          '<img src="' + productImage(product) + '" data-id="' + esc(product.id) + '" alt="' + esc(product.title) + '" loading="lazy" width="400" height="300">' +
        '</a>' +
        '<div class="card__body">' +
          '<span class="card__cat">' + esc(categoryName(product.category)) + '</span>' +
          '<h3 class="card__title"><a href="product.html?id=' + encodeURIComponent(product.id) + '">' + esc(product.title) + '</a></h3>' +
          '<div class="card__rating"><span class="stars">' + stars(product.rating) + '</span>' +
            '<span>' + product.rating.toFixed(1) + ' · ' + product.reviews + ' ' + declOfNum(product.reviews, ['отзыв', 'отзыва', 'отзывов']) + '</span></div>' +
          '<p class="card__desc">' + esc(product.desc) + '</p>' +
          '<div class="card__foot">' +
            '<span class="card__price">' + money(product.price) + '</span>' + priceOld +
            '<button class="btn btn--primary" type="button" data-add="' + esc(product.id) + '"' + (soldOut ? ' disabled' : '') + '>' +
              (soldOut ? 'Нет в наличии' : 'В корзину') + '</button>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function bindAddButtons(root) {
    root = root || document;
    $$('[data-add]', root).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        addToCart(btn.getAttribute('data-add'), 1);
      });
    });
    // Если у товара своя картинка, а файла нет — показываем сгенерированную заглушку.
    $$('img[data-id]', root).forEach(imageFallback);
  }

  /* ---------------------------- Страница каталога ------------------------- */

  function initCatalog() {
    var grid = $('#catalog-grid');
    if (!grid) return;

    var params = new URLSearchParams(location.search);
    var state = {
      cat: params.get('cat') || 'all',
      q: (params.get('q') || '').trim().toLowerCase(),
      sort: params.get('sort') || 'popular'
    };

    // фильтры-категории
    var chips = $('#catalog-chips');
    if (chips) {
      var cats = [{ id: 'all', name: 'Все товары', icon: '🐾' }].concat(CATEGORIES);
      chips.innerHTML = cats.map(function (c) {
        return '<button class="chip" type="button" data-cat="' + esc(c.id) + '">' +
          c.icon + ' ' + esc(c.name) + '</button>';
      }).join('');
      $$('.chip', chips).forEach(function (chip) {
        chip.addEventListener('click', function () {
          state.cat = chip.getAttribute('data-cat');
          render();
        });
      });
    }

    var search = $('#catalog-search');
    if (search) {
      if (state.q) search.value = state.q;
      search.addEventListener('input', function () {
        state.q = search.value.trim().toLowerCase();
        render();
      });
    }

    var sort = $('#catalog-sort');
    if (sort) {
      if (state.sort) sort.value = state.sort;
      sort.addEventListener('change', function () {
        state.sort = sort.value;
        render();
      });
    }

    function render() {
      var list = PRODUCTS.filter(function (p) {
        if (state.cat !== 'all' && p.category !== state.cat) return false;
        if (!state.q) return true;
        var haystack = (p.title + ' ' + p.desc + ' ' + categoryName(p.category)).toLowerCase();
        return haystack.indexOf(state.q) !== -1;
      });

      if (state.sort === 'cheap') list.sort(function (a, b) { return a.price - b.price; });
      else if (state.sort === 'expensive') list.sort(function (a, b) { return b.price - a.price; });
      else if (state.sort === 'name') list.sort(function (a, b) { return a.title.localeCompare(b.title, 'ru'); });
      else if (state.sort === 'rating') list.sort(function (a, b) { return b.rating - a.rating; });
      else list.sort(function (a, b) { return b.reviews - a.reviews; });

      $$('.chip', chips).forEach(function (chip) {
        chip.classList.toggle('is-active', chip.getAttribute('data-cat') === state.cat);
      });

      var counter = $('#catalog-count');
      if (counter) {
        counter.textContent = list.length
          ? 'Найдено: ' + list.length + ' ' + declOfNum(list.length, ['товар', 'товара', 'товаров'])
          : '';
      }

      if (!list.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' +
          '<div class="empty__icon">🙀</div>' +
          '<h3>Ничего не нашлось</h3>' +
          '<p>Попробуйте изменить запрос или выбрать другую категорию.</p></div>';
        return;
      }

      grid.innerHTML = list.map(cardHTML).join('');
      bindAddButtons(grid);
    }

    render();
  }

  /* -------------------------- Категории на главной ----------------------- */

  function initCategoryCards() {
    var box = $('#category-cards');
    if (!box) return;
    box.innerHTML = CATEGORIES.map(function (c) {
      var count = PRODUCTS.filter(function (p) { return p.category === c.id; }).length;
      return '<a class="cat-card" href="catalog.html?cat=' + encodeURIComponent(c.id) + '">' +
        '<div class="cat-card__icon">' + c.icon + '</div>' +
        '<h3>' + esc(c.name) + '</h3>' +
        '<p>' + esc(c.short) + '</p>' +
        '<p style="margin-top:10px;color:var(--brand-dark);font-weight:600">' + count + ' ' +
          declOfNum(count, ['товар', 'товара', 'товаров']) + ' →</p>' +
        '</a>';
    }).join('');
  }

  /* --------------------------- Хиты на главной --------------------------- */

  function initFeatured() {
    var grid = $('#featured-grid');
    if (!grid) return;
    var list = PRODUCTS.slice().sort(function (a, b) { return b.reviews - a.reviews; }).slice(0, 4);
    grid.innerHTML = list.map(cardHTML).join('');
    bindAddButtons(grid);
  }

  /* ---------------------------- Страница товара -------------------------- */

  function initProductPage() {
    var box = $('#product-page');
    if (!box) return;

    var id = new URLSearchParams(location.search).get('id');
    var product = productById(id);

    if (!product) {
      box.innerHTML = '<div class="empty"><div class="empty__icon">🙀</div>' +
        '<h2>Товар не найден</h2><p>Возможно, ссылка устарела.</p>' +
        '<a class="btn btn--primary" href="catalog.html">Перейти в каталог</a></div>';
      return;
    }

    document.title = product.title + ' — ' + SHOP.name;
    var old = product.oldPrice ? ' <span class="card__old">' + money(product.oldPrice) + '</span>' : '';
    var specs = (product.specs || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var inStock = product.stock > 0;

    box.innerHTML = '' +
      '<div class="breadcrumbs"><a href="index.html">Главная</a> / ' +
        '<a href="catalog.html?cat=' + encodeURIComponent(product.category) + '">' + esc(categoryName(product.category)) + '</a> / ' +
        esc(product.title) + '</div>' +
      '<div class="product-layout">' +
        '<div class="product-media">' +
          badgeFor(product) +
          '<img src="' + productImage(product) + '" data-id="' + esc(product.id) + '" alt="' + esc(product.title) + '" width="600" height="450">' +
        '</div>' +
        '<div class="product-info">' +
          '<span class="card__cat">' + esc(categoryName(product.category)) + '</span>' +
          '<h1>' + esc(product.title) + '</h1>' +
          '<div class="card__rating"><span class="stars">' + stars(product.rating) + '</span>' +
            '<span>' + product.rating.toFixed(1) + ' · ' + product.reviews + ' ' + declOfNum(product.reviews, ['отзыв', 'отзыва', 'отзывов']) + '</span></div>' +
          '<p>' + esc(product.desc) + '</p>' +
          '<div class="product-price">' + money(product.price) + old + '</div>' +
          '<p class="product-stock">' + (inStock
            ? '✅ В наличии: ' + product.stock + ' шт.'
            : '⛔ Временно нет в наличии') + '</p>' +
          '<div class="product-buy">' +
            '<div class="qty">' +
              '<button type="button" data-qty-minus aria-label="Меньше">−</button>' +
              '<input id="product-qty" type="number" min="1" max="' + (product.stock || 99) + '" value="1" inputmode="numeric" aria-label="Количество">' +
              '<button type="button" data-qty-plus aria-label="Больше">+</button>' +
            '</div>' +
            '<button class="btn btn--primary" type="button" id="product-add"' + (inStock ? '' : ' disabled') + '>' +
              (inStock ? 'Добавить в корзину' : 'Нет в наличии') + '</button>' +
          '</div>' +
          '<h3 style="margin-top:26px">Характеристики</h3>' +
          '<ul class="spec-list">' + specs + '</ul>' +
          '<p style="margin-top:24px"><a class="btn btn--ghost" href="cart.html">Перейти в корзину →</a></p>' +
        '</div>' +
      '</div>';

    var input = $('#product-qty');
    $('[data-qty-minus]').addEventListener('click', function () {
      input.value = Math.max(1, (parseInt(input.value, 10) || 1) - 1);
    });
    $('[data-qty-plus]').addEventListener('click', function () {
      var max = product.stock || 99;
      input.value = Math.min(max, (parseInt(input.value, 10) || 1) + 1);
    });
    var addBtn = $('#product-add');
    if (addBtn && inStock) {
      addBtn.addEventListener('click', function () { addToCart(product.id, input.value); });
    }
    bindAddButtons(box);
  }

  /* ------------------------------ Корзина --------------------------------- */

  function deliveryInfo(subtotal, method) {
    if (method === 'pickup') return 0;
    if (subtotal >= SHOP.freeShippingFrom) return 0;
    return SHOP.shippingCost;
  }

  function initCartPage() {
    var root = $('#cart-page');
    if (!root) return;

    var form = $('#checkout-form');
    var success = $('#order-success');

    function renderSuccess(order) {
      root.hidden = true;
      if (!success) return;
      var lines = order.items.map(function (item) {
        return '<li>' + esc(item.title) + ' × ' + item.qty + ' — ' + money(item.sum) + '</li>';
      }).join('');
      success.hidden = false;
      success.innerHTML = '' +
        '<div class="order-success">' +
          '<div class="order-success__icon">😻</div>' +
          '<h1>Заказ принят!</h1>' +
          '<div class="order-number">№ ' + esc(order.number) + '</div>' +
          '<p>Покажите этот номер при получении или назовите его по телефону.</p>' +
          '<div class="order-box">' +
            '<h3>Состав заказа</h3>' +
            '<ul>' + lines + '</ul>' +
            '<p style="margin:10px 0 0"><strong>Итого: ' + money(order.total) + '</strong></p>' +
            '<p class="muted" style="margin:10px 0 0">' +
              esc(order.delivery) + ' · ' + esc(order.payment) + '<br>' +
              'Получатель: ' + esc(order.name) + ', ' + esc(order.phone) +
            '</p>' +
          '</div>' +
          '<p class="pay-note">Мы позвоним по номеру ' + esc(order.phone) +
            ' в течение рабочего дня, чтобы подтвердить заказ. Оплата — при получении или переводом.</p>' +
          '<p style="margin-top:18px">' +
            '<a class="btn btn--primary" href="catalog.html">Вернуться в каталог</a> ' +
            '<button class="btn btn--ghost" type="button" onclick="window.print()">Распечатать</button>' +
          '</p>' +
        '</div>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderCart() {
      var lines = cartLines();
      var wrap = $('#cart-items');
      var summaryBox = $('#cart-summary');

      if (!lines.length) {
        wrap.innerHTML = '<div class="empty"><div class="empty__icon">🐾</div>' +
          '<h3>Корзина пуста</h3><p>Самое время выбрать что-нибудь тёплое и звонкое.</p>' +
          '<a class="btn btn--primary" href="catalog.html">В каталог</a></div>';
        summaryBox.hidden = true;
        return;
      }

      summaryBox.hidden = false;
      wrap.innerHTML = lines.map(function (line) {
        var p = line.product;
        return '<div class="cart-item" data-item="' + esc(p.id) + '">' +
          '<img class="cart-item__img" src="' + productImage(p) + '" data-id="' + esc(p.id) + '" alt="' + esc(p.title) + '" width="92" height="78">' +
          '<div>' +
            '<div class="cart-item__title"><a href="product.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.title) + '</a></div>' +
            '<div class="cart-item__meta">' + money(p.price) + ' / шт. · ' + esc(categoryName(p.category)) + '</div>' +
          '</div>' +
          '<div class="cart-item__right">' +
            '<div class="qty">' +
              '<button type="button" data-dec aria-label="Меньше">−</button>' +
              '<input type="number" min="1" max="' + (p.stock || 99) + '" value="' + line.qty + '" data-qty-input aria-label="Количество" inputmode="numeric">' +
              '<button type="button" data-inc aria-label="Больше">+</button>' +
            '</div>' +
            '<div class="cart-item__sum">' + money(line.sum) + '</div>' +
            '<button class="link-danger" type="button" data-remove>Удалить</button>' +
          '</div>' +
        '</div>';
      }).join('');

      $$('[data-item]', wrap).forEach(function (row) {
        var id = row.getAttribute('data-item');
        var input = $('[data-qty-input]', row);
        $('[data-dec]', row).addEventListener('click', function () {
          setQty(id, (parseInt(input.value, 10) || 1) - 1); renderCart();
        });
        $('[data-inc]', row).addEventListener('click', function () {
          setQty(id, (parseInt(input.value, 10) || 1) + 1); renderCart();
        });
        input.addEventListener('change', function () { setQty(id, input.value); renderCart(); });
        $('[data-remove]', row).addEventListener('click', function () {
          removeFromCart(id); toast('Товар удалён из корзины'); renderCart();
        });
      });

      updateSummary();
    }

    function updateSummary() {
      var subtotal = cartSubtotal();
      var method = ($('input[name="delivery"]:checked') || {}).value || 'courier';
      var delivery = deliveryInfo(subtotal, method);
      $('#sum-items').textContent = money(subtotal);
      $('#sum-delivery').textContent = delivery === 0
        ? (method === 'pickup' ? 'бесплатно (самовывоз)' : 'бесплатно')
        : money(delivery);
      $('#sum-discount').textContent = subtotal >= SHOP.freeShippingFrom && method === 'courier'
        ? 'доставка от ' + money(SHOP.freeShippingFrom) : '—';
      $('#sum-total').textContent = money(subtotal + delivery);
      var btn = $('#checkout-submit');
      if (btn) btn.disabled = false;
    }

    $$('input[name="delivery"]').forEach(function (radio) {
      radio.addEventListener('change', updateSummary);
    });

    // показываем сохранённый заказ, если страницу перезагрузили после оформления
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.number && !cartCount()) {
      renderSuccess(saved);
      return;
    }

    renderCart();

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var ok = true;
        function validate(name, check) {
          var field = form.querySelector('[name="' + name + '"]');
          var wrapField = field.closest('.field');
          var valid = check(field.value.trim());
          wrapField.classList.toggle('is-invalid', !valid);
          if (!valid) ok = false;
          return field.value.trim();
        }

        var name = validate('name', function (v) { return v.length >= 2; });
        var phone = validate('phone', function (v) { return v.replace(/\D/g, '').length >= 10; });
        validate('email', function (v) { return v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); });
        validate('address', function (v) {
          var method = (form.querySelector('input[name="delivery"]:checked') || {}).value;
          return method === 'pickup' ? true : v.length >= 5;
        });

        if (!ok) {
          toast('Проверьте выделенные поля');
          var firstBad = form.querySelector('.field.is-invalid input, .field.is-invalid textarea');
          if (firstBad) firstBad.focus();
          return;
        }

        var lines = cartLines();
        if (!lines.length) { toast('Корзина пуста'); return; }

        var subtotal = cartSubtotal();
        var methodValue = (form.querySelector('input[name="delivery"]:checked') || {}).value || 'courier';
        var paymentValue = (form.querySelector('input[name="payment"]:checked') || {}).value || 'cash';
        var deliveryCost = deliveryInfo(subtotal, methodValue);
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var number = 'СК-' + String(now.getFullYear()).slice(2) + pad(now.getMonth() + 1) + pad(now.getDate()) +
          '-' + String(Math.floor(1000 + Math.random() * 9000));

        var order = {
          number: number,
          date: now.toISOString(),
          name: name,
          phone: phone,
          email: form.querySelector('[name="email"]').value.trim(),
          address: form.querySelector('[name="address"]').value.trim(),
          comment: form.querySelector('[name="comment"]').value.trim(),
          delivery: methodValue === 'pickup'
            ? 'Самовывоз: ' + SHOP.address
            : 'Курьер: ' + form.querySelector('[name="address"]').value.trim(),
          payment: paymentValue === 'cash' ? 'Оплата при получении' : 'Перевод на карту',
          items: lines.map(function (l) { return { id: l.product.id, title: l.product.title, qty: l.qty, sum: l.sum }; }),
          subtotal: subtotal,
          deliveryCost: deliveryCost,
          total: subtotal + deliveryCost
        };

        try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e) { /* ignore */ }
        clearCart();
        renderSuccess(order);
      });
    }
  }

  /* --------------------------- Строка поиска в шапке --------------------- */

  function initHeaderSearch() {
    var form = $('#header-search');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = form.querySelector('input').value.trim();
      location.href = 'catalog.html' + (q ? '?q=' + encodeURIComponent(q) : '');
    });
  }

  /* -------------------------------- Старт -------------------------------- */

  document.addEventListener('DOMContentLoaded', function () {
    initHeader();
    initCategoryCards();
    initFeatured();
    initCatalog();
    initProductPage();
    initCartPage();
    initHeaderSearch();
    initShopInfo();
  });
})();
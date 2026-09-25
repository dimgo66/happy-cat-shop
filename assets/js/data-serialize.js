/* ==========================================================================
   Счастливый котик — сериализатор каталога.

   Превращает данные магазина ({ shop, categories, products }) в текст файла
   assets/js/catalog.js. Один и тот же код работает в браузере (админка) и в
   Node (сервер, тесты), поэтому результат всегда одинаковый.

   Подключение в браузере:  <script src="assets/js/data-serialize.js"></script>
   Использование в Node:    require('./data-serialize.js')
   ========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DataSerialize = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Порядок полей в файле: сначала важные, потом необязательные.
  var SHOP_KEYS = [
    'name', 'tagline', 'phone', 'email', 'address', 'hours',
    'freeShippingFrom', 'shippingCost', 'pickupDiscount'
  ];
  var CATEGORY_KEYS = ['id', 'name', 'icon', 'short'];
  var PRODUCT_KEYS = [
    'id', 'title', 'category', 'price', 'oldPrice', 'badge',
    'rating', 'reviews', 'stock', 'desc', 'specs', 'image'
  ];

  var SHOP_COMMENTS = {
    freeShippingFrom: 'бесплатная доставка от этой суммы',
    shippingCost: 'стоимость доставки курьером',
    pickupDiscount: 'скидка за самовывоз'
  };

  function quote(str) {
    return "'" + String(str == null ? '' : str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n') + "'";
  }

  function num(value) {
    var n = Number(value);
    return isFinite(n) ? String(n) : '0';
  }

  function pad(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  function serializeShop(shop) {
    var lines = SHOP_KEYS
      .filter(function (k) { return shop[k] !== undefined && shop[k] !== null; })
      .map(function (k) {
        var value = typeof shop[k] === 'number' ? num(shop[k]) : quote(shop[k]);
        var comma = k === lastDefined(SHOP_KEYS, shop) ? '' : ',';
        var line = '  ' + k + ': ' + value + comma;
        var comment = SHOP_COMMENTS[k];
        return comment ? pad(line, 30) + ' // ' + comment : line;
      });
    return 'const SHOP = {\n' + lines.join('\n') + '\n};';
  }

  function lastDefined(keys, obj) {
    var last = null;
    keys.forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null) last = k;
    });
    return last;
  }

  function serializeCategory(cat) {
    var fields = CATEGORY_KEYS
      .filter(function (k) { return cat[k] !== undefined && cat[k] !== null; })
      .map(function (k) {
        return k + ': ' + quote(cat[k]);
      })
      .join(', ');
    return '  { ' + fields + ' }';
  }

  function serializeProduct(product) {
    var lines = PRODUCT_KEYS
      .filter(function (k) { return product[k] !== undefined && product[k] !== null; })
      .map(function (k) {
        var v = product[k];
        if (k === 'specs') {
          var items = (Array.isArray(v) ? v : []).map(quote).join(', ');
          return '    specs: [' + items + ']';
        }
        if (k === 'price' || k === 'oldPrice' || k === 'reviews' || k === 'stock') {
          return '    ' + k + ': ' + num(v);
        }
        if (k === 'rating') return '    rating: ' + num(v);
        return '    ' + k + ': ' + quote(v);
      });
    return '  {\n' + lines.join(',\n') + '\n  }';
  }

  /* data = { shop, categories, products, updated } */
  function serialize(data) {
    var header = [
      '/* ==========================================================================',
      '   Счастливый котик — каталог товаров и настройки магазина.',
      '',
      '   Этот файл можно править вручную или через админку: admin.html',
      '   После ручной правки обновите страницу в браузере (Ctrl+F5).',
      '',
      '   Товар — объект в массиве PRODUCTS. Поле id должно быть уникальным,',
      '   от него зависит имя файла картинки: assets/img/products/<id>.svg',
      '   ========================================================================== */',
      ''
    ].join('\n');

    var categories = (data.categories || []).map(serializeCategory).join(',\n');
    var products = (data.products || []).map(serializeProduct).join(',\n');

    var body = [
      header,
      serializeShop(data.shop || {}),
      '',
      'const CATEGORIES = [',
      categories,
      '];',
      '',
      'const PRODUCTS = [',
      products,
      '];',
      ''
    ].join('\n');

    if (data.updated) {
      body += '\n/* Обновлено: ' + data.updated + ' */\n';
    }
    return body;
  }

  return {
    serialize: serialize,
    quote: quote,
    SHOP_KEYS: SHOP_KEYS,
    CATEGORY_KEYS: CATEGORY_KEYS,
    PRODUCT_KEYS: PRODUCT_KEYS
  };
});
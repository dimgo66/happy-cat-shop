/* ==========================================================================
   Счастливый котик — локальные правки из админки.

   Подключается ПОСЛЕ assets/js/catalog.js и ДО assets/js/app.js.

   Зачем нужен: если сервер запущен без права записи (или сайт открыт просто
   как файл), админка сохраняет изменения в браузере. Этот скрипт применяет
   такие правки к каталогу при загрузке страницы, поэтому витрина сразу
   показывает то, что вы отредактировали.

   Данные из файла catalog.js при этом не портятся: правки живут отдельно
   и удаляются кнопкой «Сбросить локальные правки» в админке.
   ========================================================================== */

(function () {
  'use strict';

  var KEY = 'happycat_overrides_v1';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.products)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  var override = read();
  if (!override) return;

  // Массивы и объект объявлены через const, поэтому не переприсваиваем их,
  // а меняем содержимое — так витрина подхватывает правки без перезагрузки кода.
  if (typeof PRODUCTS !== 'undefined' && override.products.length) {
    PRODUCTS.length = 0;
    Array.prototype.push.apply(PRODUCTS, override.products);
  }

  if (typeof CATEGORIES !== 'undefined' && Array.isArray(override.categories) && override.categories.length) {
    CATEGORIES.length = 0;
    Array.prototype.push.apply(CATEGORIES, override.categories);
  }

  if (typeof SHOP !== 'undefined' && override.shop) {
    Object.keys(override.shop).forEach(function (k) { SHOP[k] = override.shop[k]; });
  }

  // Сообщаем страницам, что работают локальные правки (админка показывает плашку).
  window.__HAPPYCAT_OVERRIDES__ = {
    savedAt: override.savedAt || null,
    products: override.products.length
  };
})();
/* Служебный скрипт: измеряет раскладку прямо внутри страницы магазина
   и печатает результат в DOM (тег <pre id="measure-out">).
   Подключается только к временным копиям страниц из tools/check-layout.cjs. */

(function () {
  'use strict';

  function finish(result) {
    var pre = document.createElement('pre');
    pre.id = 'measure-out';
    pre.textContent = 'RESULT_JSON:' + JSON.stringify(result);
    document.body.appendChild(pre);
  }

  function measure() {
    var result = {
      title: document.title,
      overflow: [], brokenImages: [], emptyBlocks: [], clippedButtons: [], ok: []
    };

    var vw = document.documentElement.clientWidth;
    result.scrollWidth = document.documentElement.scrollWidth;
    result.clientWidth = vw;

    // 1. Горизонтальное переполнение.
    // Элемент внутри контейнера с overflow-x:auto (например, широкая таблица
    // админки) — это не поломка вёрстки, а осознанная прокрутка, поэтому
    // такие элементы пропускаем: страница целиком всё равно не растягивается.
    function inScrollContainer(el) {
      var node = el.parentElement;
      while (node && node !== document.body) {
        var style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowX)) return true;
        node = node.parentElement;
      }
      return false;
    }

    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('svg')) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((r.right > vw + 1.5 || r.left < -1.5) && !inScrollContainer(el)) {
        result.overflow.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 40),
          left: Math.round(r.left), right: Math.round(r.right),
          text: (el.textContent || '').trim().slice(0, 40)
        });
      }
    }
    result.overflow = result.overflow.slice(0, 8);

    // 2. Битые изображения
    var imgs = document.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      if (!imgs[j].complete || imgs[j].naturalWidth === 0) {
        result.brokenImages.push(imgs[j].getAttribute('src'));
      }
    }

    // 3. Пустые ключевые блоки (только те, что есть на странице)
    ['#category-cards', '#featured-grid', '#catalog-grid', '#product-page', '#cart-items',
     '.site-header', '.site-footer'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.height < 5) result.emptyBlocks.push(sel + ' — высота ' + Math.round(r.height));
    });

    // 4. Обрезанный текст в кнопках и логотипе
    var buttons = document.querySelectorAll('.btn, .chip, .cart-link, .logo');
    for (var k = 0; k < buttons.length; k++) {
      var b = buttons[k];
      if (b.clientWidth > 0 && b.scrollWidth > b.clientWidth + 2) {
        result.clippedButtons.push((b.textContent || '').trim().slice(0, 30));
      }
    }
    result.clippedButtons = result.clippedButtons.slice(0, 5);

    // 5. Ключевые элементы управления на месте
    var burger = document.querySelector('[data-burger]');
    var nav = document.querySelector('#main-nav');
    var navStyle = nav ? getComputedStyle(nav) : null;
    result.ok.push('viewport=' + vw + ' (dpr ' + window.devicePixelRatio + ')');
    result.ok.push('scrollWidth=' + result.scrollWidth);
    result.ok.push('мобильное меню: ' + (burger ? getComputedStyle(burger).display : 'нет бургера') +
      ', nav=' + (navStyle ? navStyle.display : '—'));
    result.ok.push('колонок в сетке товаров=' +
      getComputedStyle(document.querySelector('.grid') || document.body).gridTemplateColumns.split(' ').length);
    result.ok.push('img=' + imgs.length + '/битых ' + result.brokenImages.length);
    result.ok.push('карточек=' + document.querySelectorAll('.card').length);
    if (document.querySelector('#cart-items')) {
      var total = document.querySelector('#sum-total');
      result.ok.push('позиций=' + document.querySelectorAll('#cart-items .cart-item').length +
        ', итого=' + (total ? total.textContent.trim() : '—'));
    }
    var h1 = document.querySelector('#product-page h1, main h1');
    if (h1) result.ok.push('заголовок: ' + h1.textContent.trim().slice(0, 42));
    result.ok.push('счётчик корзины=' + (document.querySelector('[data-cart-count]') || {}).textContent);

    finish(result);
  }

  function start() {
    setTimeout(measure, 500);
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
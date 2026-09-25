/* ==========================================================================
   Счастливый котик — генератор SVG-заглушек для товаров.

   Один и тот же код работает и в браузере (админка), и в Node
   (tools/generate-images.js), поэтому модуль не зависит ни от DOM, ни от Node.

   Подключение в браузере:  <script src="assets/js/image-gen.js"></script>
   Использование в Node:    require('./image-gen.js')
   ========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageGen = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var THEMES = {
    guitars:     { a: '#f7d9c4', b: '#e8b48c', ink: '#8a4b21' },
    keys:        { a: '#d7e5ea', b: '#a9c6d1', ink: '#2f5563' },
    studio:      { a: '#e0dbef', b: '#b7aed6', ink: '#453a6b' },
    art:         { a: '#fbe3ea', b: '#f0b9c9', ink: '#8c3352' },
    books:       { a: '#e3ecdc', b: '#bcd2ae', ink: '#3f5c37' },
    accessories: { a: '#fdeccd', b: '#f3d191', ink: '#7d5a15' }
  };

  var CAT_ICON = {
    guitars: '🎸', keys: '🎹', studio: '🎧',
    art: '🎨', books: '📚', accessories: '🎁'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function wrapTitle(title, maxLen, maxLines) {
    maxLen = maxLen || 24;
    maxLines = maxLines || 3;
    var words = String(title || '').split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var candidate = (line + ' ' + words[i]).trim();
      if (candidate.length > maxLen && line) { lines.push(line); line = words[i]; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines);
  }

  function catFace(theme) {
    return '' +
      '<g transform="translate(300 126)">' +
        '<ellipse cx="0" cy="4" rx="46" ry="40" fill="#fff8f2" stroke="' + theme.ink + '" stroke-width="3"/>' +
        '<path d="M-38 -22 L-46 -50 L-16 -34 Z" fill="#fff8f2" stroke="' + theme.ink + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M38 -22 L46 -50 L16 -34 Z" fill="#fff8f2" stroke="' + theme.ink + '" stroke-width="3" stroke-linejoin="round"/>' +
        '<circle cx="-16" cy="0" r="5" fill="' + theme.ink + '"/>' +
        '<circle cx="16" cy="0" r="5" fill="' + theme.ink + '"/>' +
        '<path d="M-9 16 Q0 24 9 16" fill="none" stroke="' + theme.ink + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M-58 2 L-86 -4 M-58 12 L-86 14" stroke="' + theme.ink + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '<path d="M58 2 L86 -4 M58 12 L86 14" stroke="' + theme.ink + '" stroke-width="2.5" stroke-linecap="round"/>' +
      '</g>';
  }

  /* Строит SVG-заглушку для товара.
     product : { id, title, category }
     categoryName : человекочитаемое имя категории (необязательно) */
  function productSvg(product, categoryName) {
    var theme = THEMES[product.category] || THEMES.guitars;
    var icon = CAT_ICON[product.category] || '🎵';
    var lines = wrapTitle(product.title);
    var titleSvg = lines.map(function (l, i) {
      return '<text x="300" y="' + (300 + i * 26) + '" text-anchor="middle" ' +
        'font-family="Segoe UI, Arial, sans-serif" font-size="21" font-weight="600" ' +
        'fill="#3a2f28">' + esc(l) + '</text>';
    }).join('\n  ');

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="600" height="450" ' +
      'role="img" aria-label="' + esc(product.title) + '">\n' +
      '  <defs>\n' +
      '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">\n' +
      '      <stop offset="0%" stop-color="' + theme.a + '"/>\n' +
      '      <stop offset="100%" stop-color="' + theme.b + '"/>\n' +
      '    </linearGradient>\n' +
      '  </defs>\n' +
      '  <rect width="600" height="450" fill="url(#bg)"/>\n' +
      '  <circle cx="72" cy="386" r="120" fill="#ffffff" opacity="0.30"/>\n' +
      '  <circle cx="548" cy="72" r="96" fill="#ffffff" opacity="0.25"/>\n' +
      '  ' + catFace(theme) + '\n' +
      '  <text x="300" y="246" text-anchor="middle" font-size="72">' + icon + '</text>\n' +
      '  ' + titleSvg + '\n' +
      '  <text x="300" y="412" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" ' +
      'font-size="15" fill="#6c5b50" letter-spacing="1">' + esc(String(categoryName || '').toUpperCase()) + '</text>\n' +
      '  <text x="300" y="54" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" ' +
      'font-size="17" font-weight="700" fill="#8a6a52" letter-spacing="2">СЧАСТЛИВЫЙ КОТИК</text>\n' +
      '</svg>\n';
  }

  return {
    productSvg: productSvg,
    THEMES: THEMES,
    CAT_ICON: CAT_ICON
  };
});
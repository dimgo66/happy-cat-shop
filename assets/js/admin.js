/* ==========================================================================
   Счастливый котик — логика админки.

   Работает в двух режимах:
   • сервер доступен  → изменения пишутся в assets/js/catalog.js
                        (перед записью создаётся резервная копия);
   • сервера нет      → изменения сохраняются в браузере и сразу видны
                        на витрине, плюс можно скачать готовый catalog.js.
   ========================================================================== */

(function () {
  'use strict';

  var OVERRIDE_KEY = 'happycat_overrides_v1';
  var CART_KEY = 'happycat_cart_v1';

  /* ----------------------------- Состояние ------------------------------- */

  // Глубокая копия исходных данных: правки идут только в рабочую копию.
  var state = {
    shop: Object.assign({}, SHOP),
    categories: CATEGORIES.map(function (c) { return Object.assign({}, c); }),
    products: PRODUCTS.map(function (p) {
      return Object.assign({}, p, { specs: (p.specs || []).slice() });
    })
  };

  var dirty = false;          // есть несохранённые изменения
  var serverWritable = false; // сервер принимает запись
  var editingIndex = -1;      // индекс товара в редакторе (-1 = новый)
  var pendingImage = null;    // { dataUrl, name } — ещё не сохранённая картинка

  /* ----------------------------- Утилиты -------------------------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(Number(value) || 0)) + ' ₽';
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }

  function setStatus(text, kind) {
    var el = $('#save-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'admin-actions__status' + (kind ? ' is-' + kind : '');
  }

  function markDirty(changed) {
    dirty = changed !== false;
    setStatus(dirty ? 'есть несохранённые изменения' : 'изменений нет');
    updateModeBadge();
  }

  function categoryName(id) {
    var found = state.categories.filter(function (c) { return c.id === id; })[0];
    return found ? found.name : '—';
  }

  function productImageSrc(product) {
    return product.image || ('assets/img/products/' + product.id + '.svg');
  }

  /* --------------------------- Режим работы ----------------------------- */

  // Адрес API: если админку открыли как файл, сервера заведомо нет.
  function apiUrl(route) {
    if (location.protocol === 'file:') return null;
    return route;
  }

  /* Обёртка над fetch: возвращает JSON, а на любой сбой кидает ошибку
     с внятным текстом, чтобы не ловить «undefined» в обработчиках. */
  function apiFetch(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () {
        throw new Error('сервер вернул не JSON (код ' + response.status + ')');
      });
    });
  }

  function updateModeBadge() {
    var badge = $('#save-mode');
    if (!badge) return;
    if (serverWritable) {
      badge.className = 'badge-state ' + (dirty ? 'badge-state--dirty' : 'badge-state--ok');
      badge.textContent = dirty ? 'сервер: сохранить в файл' : 'сервер: запись включена';
    } else {
      badge.className = 'badge-state badge-state--local';
      badge.textContent = 'браузер: локальные правки';
    }
  }

  function checkServer() {
    var url = apiUrl('/api/health');
    if (!url) { renderStatusNote(); updateModeBadge(); renderBackupsError(); return; }
    apiFetch(url)
      .then(function (info) {
        serverWritable = !!info.writable;
        if (info.readOnly) serverWritable = false;
        renderStatusNote(info);
        updateModeBadge();
        loadBackups();
      })
      .catch(function () {
        serverWritable = false;
        renderStatusNote();
        updateModeBadge();
        renderBackupsError();
      });
  }

  function renderStatusNote(info) {
    var box = $('#status-note');
    if (!box) return;
    var localEdit = window.__HAPPYCAT_OVERRIDES__;
    var html = '';

    if (serverWritable) {
      html = '<div class="admin-note admin-note--ok">' +
        '<strong>Всё готово к работе.</strong> Кнопка «Сохранить данные» запишет изменения ' +
        'в файл <code>assets/js/catalog.js</code> — сразу после этого витрина покажет новые цены ' +
        'и товары. Перед каждой записью автоматически создаётся резервная копия.' +
        '</div>';
    } else {
      html = '<div class="admin-note admin-note--warn">' +
        '<strong>Сервер недоступен — работаю в режиме локальных правок.</strong> ' +
        'Изменения сохраняются в этом браузере и сразу видны на витрине, но действуют только у вас. ' +
        'Чтобы писать прямо в файл, запустите сервер командой <code>node tools/serve.cjs</code> ' +
        'и откройте <code>http://127.0.0.1:5173/admin.html</code>. ' +
        'Либо нажмите «Скачать catalog.js» и замените файл в проекте вручную.' +
        '</div>';
    }

    if (localEdit && localEdit.products) {
      html += '<div class="admin-note">' +
        '<strong>Включены локальные правки</strong> от ' + esc(localEdit.savedAt || 'неизвестного времени') +
        ' (' + localEdit.products + ' товаров). Они перекрывают файл catalog.js. ' +
        'Чтобы вернуться к файлу, нажмите «Сбросить локальные правки» внизу страницы.' +
        '</div>';
    }

    if (info && info.products != null) {
      html += '<div class="admin-note">На диске сейчас <strong>' + info.products +
        '</strong> товаров (файл <code>' + esc(info.catalog || 'assets/js/catalog.js') + '</code>).</div>';
    }

    box.innerHTML = html;
  }

  /* --------------------------- Настройки --------------------------------- */

  var SHOP_LABELS = {
    name: 'Название магазина',
    tagline: 'Подзаголовок',
    phone: 'Телефон',
    email: 'E-mail',
    address: 'Адрес магазина',
    hours: 'Часы работы',
    freeShippingFrom: 'Бесплатная доставка от, ₽',
    shippingCost: 'Стоимость доставки, ₽',
    pickupDiscount: 'Скидка за самовывоз, ₽'
  };

  function renderShop() {
    var box = $('#shop-fields');
    if (!box) return;
    box.innerHTML = DataSerialize.SHOP_KEYS.map(function (key) {
      var value = state.shop[key];
      var isNum = typeof value === 'number';
      return '<div class="field' + (key === 'name' || key === 'tagline' ? ' field--wide' : '') + '">' +
        '<label for="s-' + key + '">' + esc(SHOP_LABELS[key] || key) + '</label>' +
        '<input id="s-' + key + '" data-shop="' + esc(key) + '" type="' + (isNum ? 'number' : 'text') + '"' +
          (isNum ? ' min="0" step="1"' : '') + ' value="' + esc(value == null ? '' : value) + '">' +
        '</div>';
    }).join('');

    $$('[data-shop]', box).forEach(function (input) {
      input.addEventListener('input', function () {
        var key = input.getAttribute('data-shop');
        state.shop[key] = input.type === 'number' ? (Number(input.value) || 0) : input.value;
        markDirty();
      });
    });
  }

  /* --------------------------- Категории --------------------------------- */

  function renderCategories() {
    var box = $('#categories-box');
    if (!box) return;
    box.innerHTML = state.categories.map(function (cat, index) {
      var used = state.products.filter(function (p) { return p.category === cat.id; }).length;
      return '<div class="admin-fields" style="margin-bottom:12px" data-cat-row="' + index + '">' +
        '<div class="field"><label>id</label>' +
          '<input type="text" data-cat="id" value="' + esc(cat.id) + '"></div>' +
        '<div class="field"><label>Иконка</label>' +
          '<input type="text" data-cat="icon" maxlength="4" value="' + esc(cat.icon) + '"></div>' +
        '<div class="field"><label>Название</label>' +
          '<input type="text" data-cat="name" value="' + esc(cat.name) + '"></div>' +
        '<div class="field"><label>Короткое описание</label>' +
          '<input type="text" data-cat="short" value="' + esc(cat.short) + '"></div>' +
        '<div class="field" style="justify-content:flex-end">' +
          '<label>Товаров: ' + used + '</label>' +
          '<button class="btn btn--ghost" type="button" data-cat-remove="' + index + '"' +
            (used ? ' title="В категории есть товары — сначала перенесите их"' : '') + '>Удалить</button>' +
        '</div>' +
      '</div>';
    }).join('');

    $$('[data-cat-row]', box).forEach(function (row) {
      var index = Number(row.getAttribute('data-cat-row'));
      $$('[data-cat]', row).forEach(function (input) {
        input.addEventListener('input', function () {
          state.categories[index][input.getAttribute('data-cat')] = input.value;
          markDirty();
        });
      });
      $('[data-cat-remove]', row).addEventListener('click', function () {
        var used = state.products.filter(function (p) { return p.category === state.categories[index].id; }).length;
        if (used) { toast('В категории ' + used + ' товаров — сначала перенесите их'); return; }
        if (!confirm('Удалить категорию «' + state.categories[index].name + '»?')) return;
        state.categories.splice(index, 1);
        markDirty();
        renderCategories();
        renderProducts();
        fillCategorySelects();
      });
    });
  }

  function fillCategorySelects() {
    var filter = $('#admin-filter');
    if (filter) {
      var current = filter.value;
      filter.innerHTML = '<option value="all">Все категории</option>' +
        state.categories.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.icon + ' ' + c.name) + '</option>';
        }).join('');
      filter.value = state.categories.some(function (c) { return c.id === current; }) ? current : 'all';
    }
    var editor = $('#e-category');
    if (editor) {
      var currentCat = editor.value;
      editor.innerHTML = state.categories.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.icon + ' ' + c.name) + '</option>';
      }).join('');
      if (state.categories.some(function (c) { return c.id === currentCat; })) editor.value = currentCat;
    }
  }

  /* ----------------------------- Товары ---------------------------------- */

  function visibleProducts() {
    var query = ($('#admin-search') || {}).value || '';
    query = query.trim().toLowerCase();
    var cat = ($('#admin-filter') || {}).value || 'all';

    return state.products
      .map(function (product, index) { return { product: product, index: index }; })
      .filter(function (row) {
        if (cat !== 'all' && row.product.category !== cat) return false;
        if (!query) return true;
        return (row.product.title + ' ' + row.product.id).toLowerCase().indexOf(query) !== -1;
      });
  }

  function renderProducts() {
    var body = $('#products-body');
    if (!body) return;
    var rows = visibleProducts();

    var counter = $('#admin-count');
    if (counter) counter.textContent = 'показано ' + rows.length + ' из ' + state.products.length;

    var empty = $('#products-empty');
    if (empty) empty.hidden = rows.length > 0;

    body.innerHTML = rows.map(function (row) {
      var p = row.product;
      return '<tr data-index="' + row.index + '"' + (row.index === editingIndex ? ' class="is-editing"' : '') + '>' +
        '<td class="col-img"><img src="' + esc(productImageSrc(p)) + '" alt="" loading="lazy" ' +
          'onerror="this.onerror=null;this.src=\'assets/img/products/' + esc(p.id) + '.svg\'"></td>' +
        '<td>' +
          '<input type="text" data-field="title" value="' + esc(p.title) + '" aria-label="Название">' +
          '<div class="id-cell">' + esc(p.id) + (p.badge ? ' · ' + esc(p.badge) : '') + '</div>' +
        '</td>' +
        '<td>' +
          '<select data-field="category" aria-label="Категория">' +
            state.categories.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (c.id === p.category ? ' selected' : '') + '>' +
                esc(c.name) + '</option>';
            }).join('') +
          '</select>' +
        '</td>' +
        '<td class="col-num"><input type="number" min="0" step="1" data-field="price" value="' + esc(p.price) + '" aria-label="Цена"></td>' +
        '<td class="col-num"><input type="number" min="0" step="1" data-field="oldPrice" value="' +
          esc(p.oldPrice == null ? '' : p.oldPrice) + '" aria-label="Старая цена"></td>' +
        '<td class="col-num"><input type="number" min="0" step="1" data-field="stock" value="' + esc(p.stock) + '" aria-label="Остаток"></td>' +
        '<td class="col-act"><button class="icon-btn" type="button" data-edit="' + row.index + '" title="Название, описание, фото">✎</button></td>' +
        '<td class="col-act"><button class="icon-btn icon-btn--danger" type="button" data-delete="' + row.index + '" title="Удалить товар">🗑</button></td>' +
      '</tr>';
    }).join('');

    $$('tr[data-index]', body).forEach(function (tr) {
      var index = Number(tr.getAttribute('data-index'));
      $$('[data-field]', tr).forEach(function (input) {
        input.addEventListener('input', function () { applyInline(tr, index); });
        input.addEventListener('change', function () { applyInline(tr, index); });
      });
      $('[data-edit]', tr).addEventListener('click', function () { openEditor(index); });
      $('[data-delete]', tr).addEventListener('click', function () { removeProduct(index); });
    });
  }

  // Быстрые правки прямо в таблице: цена, наличие, категория, название.
  function applyInline(tr, index) {
    var product = state.products[index];
    $$('[data-field]', tr).forEach(function (input) {
      var field = input.getAttribute('data-field');
      var value = input.value;
      if (field === 'price' || field === 'stock') {
        product[field] = Math.max(0, Math.round(Number(value) || 0));
      } else if (field === 'oldPrice') {
        if (value === '') delete product.oldPrice;
        else product.oldPrice = Math.max(0, Math.round(Number(value) || 0));
      } else {
        product[field] = value;
      }
    });
    markDirty();
  }

  function removeProduct(index) {
    var product = state.products[index];
    var inCart = 0;
    try {
      inCart = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
        .filter(function (row) { return row.id === product.id; }).length;
    } catch (e) { inCart = 0; }

    var warning = 'Удалить товар «' + product.title + '»?' +
      (inCart ? '\n\nОн лежит в корзине покупателя — оттуда он исчезнет сам.' : '');
    if (!confirm(warning)) return;

    state.products.splice(index, 1);
    if (editingIndex === index) closeEditor();
    markDirty();
    renderProducts();
    renderCategories();
  }

  function uniqueId(base) {
    var candidate = base;
    var n = 2;
    while (state.products.some(function (p) { return p.id === candidate; })) {
      candidate = base + '-' + n;
      n++;
    }
    return candidate;
  }

  function addProduct() {
    var id = uniqueId('new-1');
    state.products.unshift({
      id: id,
      title: 'Новый товар',
      category: state.categories[0] ? state.categories[0].id : '',
      price: 1000,
      rating: 5,
      reviews: 0,
      stock: 1,
      desc: '',
      specs: []
    });
    markDirty();
    renderProducts();
    openEditor(0);
    var titleInput = $('#e-title');
    if (titleInput) { titleInput.focus(); titleInput.select(); }
  }

  /* --------------------------- Редактор товара --------------------------- */

  function openEditor(index) {
    editingIndex = index;
    var product = state.products[index];
    if (!product) return;

    pendingImage = null;
    $('#editor-section').hidden = false;
    $('#editor-title').textContent = 'Редактирование: ' + product.title;

    $('#e-id').value = product.id;
    $('#e-title').value = product.title;
    $('#e-price').value = product.price;
    $('#e-old-price').value = product.oldPrice == null ? '' : product.oldPrice;
    $('#e-stock').value = product.stock;
    $('#e-rating').value = product.rating;
    $('#e-reviews').value = product.reviews;
    $('#e-desc').value = product.desc || '';
    $('#e-badge').value = product.badge || '';
    fillCategorySelects();
    $('#e-category').value = product.category;
    renderSpecs(product.specs || []);
    updateImagePreview();
    $('#editor-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderProducts();
  }

  function closeEditor() {
    editingIndex = -1;
    pendingImage = null;
    var section = $('#editor-section');
    if (section) section.hidden = true;
    renderProducts();
  }

  function renderSpecs(specs) {
    var box = $('#spec-editor');
    if (!box) return;
    box.innerHTML = specs.map(function (value) {
      return '<div class="spec-row">' +
        '<input type="text" data-spec value="' + esc(value) + '" placeholder="Например: Верх: массив ели">' +
        '<button class="icon-btn icon-btn--danger" type="button" data-spec-remove title="Удалить">✕</button>' +
      '</div>';
    }).join('');
    $$('[data-spec-remove]', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.parentNode.remove();
      });
    });
  }

  function collectSpecs() {
    return $$('#spec-editor [data-spec]')
      .map(function (input) { return input.value.trim(); })
      .filter(Boolean);
  }

  function updateImagePreview() {
    var preview = $('#e-image-preview');
    if (!preview) return;
    var product = state.products[editingIndex];
    if (pendingImage) preview.src = pendingImage.dataUrl;
    else if (product) preview.src = productImageSrc(product);
    else preview.src = 'assets/img/favicon.svg';
  }

  function applyEditor() {
    var product = state.products[editingIndex];
    if (!product) return;

    var id = $('#e-id').value.trim();
    var title = $('#e-title').value.trim();
    var price = Math.round(Number($('#e-price').value) || 0);

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      toast('id может содержать только латиницу, цифры, - и _');
      $('#e-id').focus();
      return;
    }
    if (state.products.some(function (p, i) { return p.id === id && i !== editingIndex; })) {
      toast('Товар с id «' + id + '» уже есть');
      $('#e-id').focus();
      return;
    }
    if (!title) { toast('Заполните название'); $('#e-title').focus(); return; }

    product.id = id;
    product.title = title;
    product.category = $('#e-category').value;
    product.price = price;
    product.stock = Math.max(0, Math.round(Number($('#e-stock').value) || 0));
    product.rating = Math.min(5, Math.max(0, Number($('#e-rating').value) || 0));
    product.reviews = Math.max(0, Math.round(Number($('#e-reviews').value) || 0));
    product.desc = $('#e-desc').value.trim();
    product.specs = collectSpecs();

    var oldPrice = $('#e-old-price').value;
    if (oldPrice === '') delete product.oldPrice;
    else product.oldPrice = Math.max(0, Math.round(Number(oldPrice) || 0));

    var badge = $('#e-badge').value;
    if (badge) product.badge = badge; else delete product.badge;

    markDirty();

    if (pendingImage) {
      saveImage(id, pendingImage.dataUrl);
    } else {
      closeEditor();
      renderProducts();
      toast('Товар обновлён');
    }
  }

  /* ----------------------------- Картинки -------------------------------- */

  function saveImage(id, dataUrl) {
    var url = apiUrl('/api/save-image');
    if (!url || !serverWritable) {
      // Без сервера картинку в файл не положить — честно об этом сообщаем.
      toast('Картинка не сохранена: нужен запущенный сервер (node tools/serve.cjs)');
      pendingImage = null;
      closeEditor();
      renderProducts();
      return;
    }
    apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, dataUrl: dataUrl })
    })
      .then(function (result) {
        if (!result.ok) { toast('Картинка не сохранена: ' + result.error); return; }
        var product = state.products.filter(function (p) { return p.id === id; })[0];
        if (product) product.image = result.file;
        pendingImage = null;
        toast('Картинка загружена');
        markDirty();
      })
      .catch(function () { toast('Не удалось загрузить картинку'); })
      .then(function () {
        closeEditor();
        renderProducts();
      });
  }

  function bindImageInput() {
    var input = $('#e-image-file');
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast('Файл больше 2 МБ — сожмите картинку');
        input.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        pendingImage = { dataUrl: reader.result, name: file.name };
        updateImagePreview();
        var status = $('#e-image-status');
        if (status) status.textContent = 'Выбрано: ' + file.name + ' — нажмите «Применить».';
      };
      reader.readAsDataURL(file);
    });

    $('#e-image-clear').addEventListener('click', function () {
      pendingImage = null;
      var product = state.products[editingIndex];
      if (product) delete product.image;
      input.value = '';
      var status = $('#e-image-status');
      if (status) status.textContent = 'Будет использована сгенерированная заглушка.';
      updateImagePreview();
      markDirty();
    });
  }

  /* ---------------------------- Сохранение ------------------------------- */

  function payload() {
    return {
      shop: state.shop,
      categories: state.categories,
      products: state.products
    };
  }

  function catalogText() {
    return DataSerialize.serialize({
      shop: state.shop,
      categories: state.categories,
      products: state.products,
      updated: new Date().toLocaleString('ru-RU')
    });
  }

  function saveToServer() {
    var url = apiUrl('/api/save-data');
    if (!url) return Promise.reject(new Error('Сервер недоступен (страница открыта как файл)'));

    setStatus('сохраняю…');
    return apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload() })
    })
      .then(function (result) {
        if (!result.ok) throw new Error(result.error || 'неизвестная ошибка');
        dirty = false;
        setStatus('сохранено в файл в ' + new Date().toLocaleTimeString('ru-RU'), 'saved');
        toast('Сохранено в assets/js/catalog.js');
        loadBackups();
        updateModeBadge();
        // локальные правки больше не нужны — файл теперь источник истины
        clearLocalOverrides(true);
        return result;
      })
      .catch(function (e) {
        setStatus('ошибка: ' + e.message, 'error');
        toast('Не сохранено: ' + e.message);
        throw e;
      });
  }

  function saveLocal() {
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify({
        shop: state.shop,
        categories: state.categories,
        products: state.products,
        savedAt: new Date().toLocaleString('ru-RU')
      }));
      dirty = false;
      setStatus('сохранено в браузере в ' + new Date().toLocaleTimeString('ru-RU'), 'saved');
      toast('Сохранено в браузере — витрина уже показывает изменения');
      renderStatusNote(null);
      updateModeBadge();
    } catch (e) {
      setStatus('не удалось сохранить: ' + e.message, 'error');
      toast('Ошибка сохранения: ' + e.message);
    }
  }

  function saveAll() {
    if (serverWritable) {
      saveToServer().catch(function () {
        // Сервер отказал — предлагаем запасной путь, не теряя правки.
        if (confirm('Сервер не принял данные. Сохранить изменения в браузере?')) saveLocal();
      });
    } else {
      saveLocal();
    }
  }

  function downloadCatalog() {
    var blob = new Blob([catalogText()], { type: 'text/javascript;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'catalog.js';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    toast('Файл catalog.js скачан — замените им assets/js/catalog.js');
  }

  function clearLocalOverrides(silent) {
    try { localStorage.removeItem(OVERRIDE_KEY); } catch (e) { /* ignore */ }
    var info = window.__HAPPYCAT_OVERRIDES__;
    if (info) delete window.__HAPPYCAT_OVERRIDES__;
    if (!silent) {
      renderStatusNote(null);
      toast('Локальные правки сброшены — нужна перезагрузка страницы');
      setTimeout(function () { location.reload(); }, 900);
    }
  }

  /* -------------------------- Резервные копии ---------------------------- */

  function loadBackups() {
    var url = apiUrl('/api/backups');
    if (!url) { renderBackupsError(); return; }
    apiFetch(url)
      .then(function (result) {
        var list = $('#backups-list');
        if (!list) return;
        if (!result.ok || !result.backups.length) {
          list.innerHTML = '<li><span class="muted">Копий пока нет — они появятся после первого сохранения.</span></li>';
          return;
        }
        list.innerHTML = result.backups.map(function (backup) {
          var when = backup.name.replace(/^catalog-/, '').replace(/\.js$/, '');
          var pretty = when.replace(
            /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/,
            '$3.$2.$1 $4:$5:$6'
          );
          return '<li>' +
            '<span>' + esc(pretty) + '</span>' +
            '<span class="muted">' + Math.round(backup.size / 1024) + ' КБ</span>' +
            '<button class="btn btn--ghost" type="button" data-restore="' + esc(backup.name) + '">Восстановить</button>' +
            '</li>';
        }).join('');

        $$('[data-restore]', list).forEach(function (btn) {
          btn.addEventListener('click', function () {
            var name = btn.getAttribute('data-restore');
            if (!confirm('Вернуть каталог к состоянию ' + name + '?\nТекущие данные тоже будут сохранены в копию.')) return;
            apiFetch(apiUrl('/api/restore'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: name })
            })
              .then(function (res) {
                if (!res.ok) { toast('Не восстановлено: ' + res.error); return; }
                toast('Восстановлено — перезагружаю страницу');
                setTimeout(function () { location.reload(); }, 800);
              })
              .catch(function () { toast('Не удалось восстановить'); });
          });
        });
      })
      .catch(renderBackupsError);
  }

  function renderBackupsError() {
    var list = $('#backups-list');
    if (list) {
      list.innerHTML = '<li><span class="muted">Недоступно без сервера. ' +
        'Запустите <code>node tools/serve.cjs</code>.</span></li>';
    }
  }

  function makeBackupNow() {
    if (!serverWritable) { toast('Резервные копии доступны только при запущенном сервере'); return; }
    // Копию делает сервер перед сохранением — здесь сохраняем и сразу её создаём.
    saveToServer().then(function () { toast('Копия создана'); });
  }

  /* ------------------------------- Старт --------------------------------- */

  function bindToolbar() {
    $('#save-all').addEventListener('click', saveAll);
    $('#download-data').addEventListener('click', downloadCatalog);
    $('#make-backup').addEventListener('click', makeBackupNow);
    $('#reset-local').addEventListener('click', function () {
      if (confirm('Сбросить правки, сохранённые в браузере?\nФайл catalog.js останется без изменений.')) {
        clearLocalOverrides(false);
      }
    });

    $('#add-product').addEventListener('click', addProduct);
    $('#add-category').addEventListener('click', function () {
      var id = 'cat-' + (state.categories.length + 1);
      while (state.categories.some(function (c) { return c.id === id; })) id += 'x';
      state.categories.push({ id: id, name: 'Новая категория', icon: '🎵', short: '' });
      markDirty();
      renderCategories();
      fillCategorySelects();
    });
    $('#add-spec').addEventListener('click', function () {
      renderSpecs(collectSpecs().concat(['']));
      var inputs = $$('#spec-editor [data-spec]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    $('#editor-apply').addEventListener('click', applyEditor);
    $('#editor-cancel').addEventListener('click', closeEditor);

    $('#admin-search').addEventListener('input', renderProducts);
    $('#admin-filter').addEventListener('change', renderProducts);

    $('#reload-data').addEventListener('click', function () {
      if (dirty && !confirm('Есть несохранённые изменения — они будут потеряны. Перечитать данные?')) return;
      location.reload();
    });
  }

  // Предупреждаем о несохранённых правках при закрытии страницы.
  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.addEventListener('DOMContentLoaded', function () {
    renderShop();
    renderCategories();
    fillCategorySelects();
    renderProducts();
    bindImageInput();
    bindToolbar();
    checkServer();
    updateModeBadge();
  });
})();
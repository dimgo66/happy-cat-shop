/* Проверка админки в настоящем браузере: клики, ввод, предпросмотр витрины.

   Запуск: node tools/admin-browser-test.cjs

   Тест сам поднимает отдельный сервер в режиме «только чтение»
   (node tools/serve.cjs <порт> --read-only), поэтому физически не может
   исправить assets/js/catalog.js. Дополнительно до и после прогона
   сравнивается контрольная сумма файла — если она изменилась, тест падает.

   Сохранение в файл проверяется отдельно, на уровне API: tools/admin-test.cjs */

const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const CATALOG = path.join(root, 'assets/js/catalog.js');
const PORT = Number(process.argv[2]) || 8795;
const base = 'http://127.0.0.1:' + PORT;

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

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function waitForServer(url, attempts) {
  return new Promise((resolve, reject) => {
    let left = attempts || 40;
    const tick = () => {
      const req = require('http').get(url + '/api/health', (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve(JSON.parse(raw)));
      });
      req.on('error', () => {
        if (--left <= 0) return reject(new Error('сервер не поднялся'));
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

/* Сценарий выполняется внутри страницы админки — как действия пользователя. */
const SCENARIO = `
(function () {
  var out = { checks: [], errors: [] };
  function check(label, condition, extra) {
    out.checks.push({ label: label, ok: !!condition, extra: extra == null ? '' : String(extra) });
  }
  window.addEventListener('error', function (e) { out.errors.push(String(e.message)); });

  function finish() {
    var pre = document.createElement('pre');
    pre.id = 'test-out';
    pre.textContent = 'RESULT_JSON:' + JSON.stringify(out);
    document.body.appendChild(pre);
  }

  function rows() { return document.querySelectorAll('#products-body tr'); }
  function rowByIndex(i) { return document.querySelector('#products-body tr[data-index="' + i + '"]'); }

  setTimeout(function () {
    try {
      check('таблица товаров заполнена', rows().length === 23, rows().length);
      check('поля настроек магазина есть',
        document.querySelectorAll('[data-shop]').length === 9,
        document.querySelectorAll('[data-shop]').length);
      check('категории отрисованы',
        document.querySelectorAll('[data-cat-row]').length === 6,
        document.querySelectorAll('[data-cat-row]').length);
      check('шапка сообщает о режиме только для чтения',
        /браузер/.test(document.querySelector('#save-mode').textContent),
        document.querySelector('#save-mode').textContent);
      check('есть предупреждение про сервер без записи',
        /локальных правок/.test(document.querySelector('#status-note').textContent));

      // правка цены прямо в таблице
      var priceInput = rowByIndex(0).querySelector('[data-field="price"]');
      priceInput.value = '31337';
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      check('статус показывает несохранённые изменения',
        /несохранённые/.test(document.querySelector('#save-status').textContent),
        document.querySelector('#save-status').textContent);

      // остаток -> 0: товар должен стать «нет в наличии»
      var stockInput = rowByIndex(0).querySelector('[data-field="stock"]');
      stockInput.value = '0';
      stockInput.dispatchEvent(new Event('input', { bubbles: true }));

      // переключение категории
      var catSelect = rowByIndex(1).querySelector('[data-field="category"]');
      var otherCat = Array.prototype.filter.call(catSelect.options, function (o) {
        return o.value !== catSelect.value;
      })[0];
      catSelect.value = otherCat.value;
      catSelect.dispatchEvent(new Event('change', { bubbles: true }));
      check('категория товара переключилась', catSelect.value === otherCat.value, catSelect.value);

      // поиск
      var search = document.querySelector('#admin-search');
      search.value = 'гитара';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      check('поиск сузил список', rows().length > 0 && rows().length < 23, rows().length);
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      check('сброс поиска вернул все товары', rows().length === 23, rows().length);

      // редактор
      rowByIndex(0).querySelector('[data-edit]').dispatchEvent(new Event('click', { bubbles: true }));
      var editor = document.querySelector('#editor-section');
      check('редактор открыт', editor.hidden === false);
      check('редактор подставил цену', document.querySelector('#e-price').value === '31337',
        document.querySelector('#e-price').value);
      check('характеристики загружены в редактор',
        document.querySelectorAll('#spec-editor [data-spec]').length === 4,
        document.querySelectorAll('#spec-editor [data-spec]').length);
      document.querySelector('#add-spec').dispatchEvent(new Event('click', { bubbles: true }));
      check('характеристика добавлена',
        document.querySelectorAll('#spec-editor [data-spec]').length === 5);

      // применение правок
      document.querySelector('#e-title').value = 'Гитара после теста';
      document.querySelector('#e-old-price').value = '99999';
      document.querySelector('#e-badge').value = 'Новинка';
      document.querySelector('#editor-apply').dispatchEvent(new Event('click', { bubbles: true }));
      check('редактор закрылся после применения', editor.hidden === true);
      check('название обновилось в таблице',
        rowByIndex(0).querySelector('[data-field="title"]').value === 'Гитара после теста',
        rowByIndex(0).querySelector('[data-field="title"]').value);
      check('плашка «Новинка» показана в строке', /Новинка/.test(rowByIndex(0).textContent));

      // добавление товара
      document.querySelector('#add-product').dispatchEvent(new Event('click', { bubbles: true }));
      check('товаров стало 24', rows().length === 24, rows().length);
      check('редактор открыт на новом товаре', editor.hidden === false);
      var newId = document.querySelector('#e-id').value;
      check('у нового товара уникальный id', newId && newId.length > 0, newId);
      document.querySelector('#editor-cancel').dispatchEvent(new Event('click', { bubbles: true }));
      check('отмена закрыла редактор', editor.hidden === true);

      // локальное сохранение (сервер только для чтения, поэтому именно оно)
      document.querySelector('#save-all').dispatchEvent(new Event('click', { bubbles: true }));

      setTimeout(function () {
        try {
          var stored = null;
          try { stored = JSON.parse(localStorage.getItem('happycat_overrides_v1') || 'null'); } catch (e) {}
          check('правки сохранены в браузере', !!stored && stored.products.length === 24,
            stored ? stored.products.length : 'нет');
          if (stored) {
            check('цена 31 337 ₽ попала в сохранённые данные',
              stored.products.some(function (p) { return p.price === 31337; }));
            check('название из редактора сохранилось',
              stored.products.some(function (p) { return p.title === 'Гитара после теста'; }));
            check('настройки магазина сохранены', !!stored.shop);
          }

          // витрина в этом же браузере должна показать правки
          var frame = document.createElement('iframe');
          frame.style.cssText = 'position:absolute;left:-9999px;width:1200px;height:900px';
          frame.src = 'catalog.html';
          document.body.appendChild(frame);
          frame.addEventListener('load', function () {
            setTimeout(function () {
              try {
                var doc = frame.contentDocument;
                var cards = doc.querySelectorAll('#catalog-grid .card');
                var text = doc.querySelector('#catalog-grid').textContent;
                check('витрина отрисовала 24 товара из локальных правок', cards.length === 24, cards.length);
                check('витрина показывает новую цену', /31\\s?337/.test(text));
                check('витрина показывает новое название', /Гитара после теста/.test(text));
                check('товар с нулевым остатком помечен как отсутствующий', /Нет в наличии/.test(text));
              } catch (e) { out.errors.push('витрина: ' + e.message); }
              finish();
            }, 700);
          });
        } catch (e) {
          out.errors.push('сохранение: ' + e.message);
          finish();
        }
      }, 800);
    } catch (e) {
      out.errors.push('сценарий: ' + e.message);
      finish();
    }
  }, 1000);
})();
`;

const harness = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>admin-test</title>
<style>body{margin:0;font:13px monospace}</style></head><body>
<iframe id="f" style="width:1280px;height:1000px;border:0"></iframe>
<pre id="log">running…</pre>
<script>
var frame = document.getElementById('f');
frame.src = ${JSON.stringify(base + '/admin.html')};
frame.addEventListener('load', function onLoad() {
  frame.removeEventListener('load', onLoad);
  setTimeout(function () {
    var doc = frame.contentDocument;
    var script = doc.createElement('script');
    script.textContent = ${JSON.stringify(SCENARIO)};
    doc.body.appendChild(script);
  }, 900);
});
var poll = setInterval(function () {
  try {
    var inner = frame.contentDocument.getElementById('test-out');
    if (inner) { clearInterval(poll); document.getElementById('log').textContent = inner.textContent; }
  } catch (e) {}
}, 200);
setTimeout(function () { clearInterval(poll); }, 40000);
</script></body></html>`;

(async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('Не найден Chrome/Edge. Укажите путь в переменной CHROME_PATH.');
    process.exit(2);
  }

  const before = hashFile(CATALOG);

  // Свой сервер в режиме «только чтение» — файл проекта в безопасности.
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), String(PORT), '--read-only'], {
    cwd: root, stdio: 'ignore'
  });

  const harnessFile = path.join(__dirname, '_admin-test-harness.html');
  // Профиль браузера делаем свежим на каждый прогон: иначе в localStorage
  // остаются локальные правки прошлого теста, и подсчёт товаров «плывёт».
  const tmpProfile = path.join(process.env.TEMP || '/tmp',
    'cat-admin-browser-' + Date.now() + '-' + process.pid);
  let exitCode = 0;

  try {
    const health = await waitForServer(base, 40);
    if (!health.readOnly) {
      console.error('Сервер запустился не в режиме только для чтения — прерываю, чтобы не испортить файл.');
      exitCode = 1;
      return;
    }

    fs.writeFileSync(harnessFile, harness, 'utf8');

    const res = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + tmpProfile,
      '--virtual-time-budget=30000',
      '--window-size=1400,1200',
      '--dump-dom', base + '/tools/_admin-test-harness.html'
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });

    const dom = (res.stdout || '') + (res.stderr || '');
    const matches = dom.match(/RESULT_JSON:(\{[\s\S]*?\})<\/pre>/g);

    if (!matches) {
      console.log('Не удалось получить результат из браузера.');
      console.log(dom.slice(0, 700));
      exitCode = 1;
      return;
    }

    const raw = matches[matches.length - 1].replace(/^RESULT_JSON:/, '').replace(/<\/pre>$/, '');
    const result = JSON.parse(raw
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));

    let passed = 0, failed = 0;
    console.log('Проверка админки в браузере (сервер только для чтения)\n');
    result.checks.forEach((c) => {
      if (c.ok) { passed++; console.log('  ok   ' + c.label); }
      else { failed++; console.log('  FAIL ' + c.label + (c.extra ? ' → ' + c.extra : '')); }
    });

    if (result.errors.length) {
      console.log('\nОшибки в браузере:');
      result.errors.forEach((e) => console.log('  ' + e));
      failed++;
    }

    // Главная гарантия безопасности: файл не тронут.
    const after = hashFile(CATALOG);
    if (before === after) {
      passed++;
      console.log('\n  ok   assets/js/catalog.js не изменён тестом');
    } else {
      failed++;
      console.log('\n  FAIL assets/js/catalog.js ИЗМЕНЁН тестом!');
    }

    console.log('\nИтог: ' + passed + ' успешно, ' + failed + ' провалено');
    exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error('Ошибка теста: ' + e.message);
    exitCode = 1;
  } finally {
    if (fs.existsSync(harnessFile)) fs.unlinkSync(harnessFile);
    server.kill();
    try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) { /* профиль мог остаться занят */ }
  }

  process.exit(exitCode);
})();
/* Генератор SVG-иллюстраций товаров из assets/js/catalog.js.

   Запуск:  node tools/generate-images.js
   Создаёт assets/img/products/<id>.svg для каждого товара, у которого
   ещё нет картинки, — удобно после добавления товара в админке. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ImageGen = require('../assets/js/image-gen.js');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/catalog.js'), 'utf8');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '\n;this.PRODUCTS = PRODUCTS; this.CATEGORIES = CATEGORIES;', sandbox);

const { PRODUCTS, CATEGORIES } = sandbox;
const outDir = path.join(root, 'assets/img/products');
fs.mkdirSync(outDir, { recursive: true });

let created = 0, skipped = 0;
for (const product of PRODUCTS) {
  const target = path.join(outDir, product.id + '.svg');
  if (fs.existsSync(target)) { skipped++; continue; }
  const category = CATEGORIES.find((c) => c.id === product.category);
  fs.writeFileSync(target, ImageGen.productSvg(product, category && category.name), 'utf8');
  created++;
}

console.log('Готово: создано ' + created + ', уже было ' + skipped +
  ' (всего товаров ' + PRODUCTS.length + ')');
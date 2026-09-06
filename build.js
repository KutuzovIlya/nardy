/* Собирает одностраничную версию игры: dist/nardy.html
   Стили и скрипты встраиваются внутрь, служебные теги документа убираются —
   такой файл можно открыть с диска или опубликовать как артефакт. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

/* заглушка хранилища нужна только для локальной отладки */
html = html.replace(/\s*<script src="js\/mock-db\.js[^"]*"><\/script>/, '');

html = html.replace(
  /<link rel="stylesheet" href="css\/style\.css[^"]*">/,
  '<style>\n' + read('css/style.css').trim() + '\n</style>'
);

html = html.replace(/<script src="(js\/[^"?]+)[^"]*"><\/script>/g, (_, src) =>
  '<script>\n' + read(src).trim() + '\n</script>'
);

/* обёртка документа не нужна: артефакт добавляет свою */
html = html
  .replace(/^<!doctype html>\s*/i, '')
  .replace(/<html lang="ru">\s*/, '')
  .replace(/<\/html>\s*$/, '')
  .replace(/<head>\s*/, '')
  .replace(/\s*<\/head>\s*/, '\n')
  .replace(/<body>\s*/, '')
  .replace(/\s*<\/body>/, '')
  .replace(/^<meta charset="utf-8">\n/m, '')
  .replace(/^<meta name="viewport"[^>]*>\n/m, '');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/nardy.html'), html.trim() + '\n');

const kb = (fs.statSync(path.join(root, 'dist/nardy.html')).size / 1024).toFixed(0);
console.log('dist/nardy.html — ' + kb + ' КБ');

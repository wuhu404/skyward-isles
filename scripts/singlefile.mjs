// 把 dist/ 的 JS 和 CSS 内联进一个 HTML，得到可以直接双击打开（file://）的单文件版本。
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/, (_, f) => `<style>${read(f)}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/, '');
const js = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.js'));
// 内联模块脚本放在 body 末尾；转义 </script 以免提前结束标签
const code = read(`assets/${js}`).replace(/<\/script/gi, '<\\/script');
html = html.replace('</body>', () => `<script type="module">${code}</script>\n  </body>`);
if (/(src|href)="\.\//.test(html)) throw new Error('仍有未内联的外部资源');

const out = path.join(dist, 'skyward-isles.html');
fs.writeFileSync(out, html);
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);

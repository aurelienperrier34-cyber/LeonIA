const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const item = game.match(/id: 'magic-hat',[^\n]+img: '([^']+)'[^\n]+sprite: '([^']+)'/);

assert(item, 'Le chapeau magique doit avoir une image et un sprite');
assert.strictEqual(item[1], item[2], 'La boutique et le vestiaire doivent utiliser le même chapeau');

const png = fs.readFileSync(path.join(root, item[2]));
assert.strictEqual(png.readUInt8(25), 6, 'Le sprite du chapeau doit conserver sa transparence RGBA');

console.log('OK: même chapeau transparent dans la boutique et le vestiaire');

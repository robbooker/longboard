'use strict';
const fs = require('node:fs');
const child = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const anchor = '    await writeHistoryFeed(client, channel);\n\n    if (!watch) {';
const addition = `    // CHAT_GAINERS_RELAY: independent of TraderRadio filters; watch mode only.
    if (watch && process.env.CHAT_GAINERS_ENABLED === "1") {
      try {
        const { attachConfiguredGainers } = require("./lib/gainers/gainers-listener-glue.cjs");
        await attachConfiguredGainers({ client, channel });
      } catch {
        console.error("Chat Gainers disabled: integration module unavailable; TraderRadio continues.");
      }
    }

`;
function patchSource(original) {
  if (original.includes('CHAT_GAINERS_RELAY') || original.split(anchor).length !== 2) throw new Error('Listener anchors changed or patch already installed');
  const at = original.indexOf(anchor);
  const dumpAt = original.indexOf('    if (dumpMessages) {');
  if (dumpAt < 0 || dumpAt >= at || !original.includes('const require = createRequire(import.meta.url);')) throw new Error('Listener structure changed');
  return original.replace(anchor, addition + anchor);
}
if (require.main === module) {
  const snapshot = process.argv[2];
  if (!snapshot) throw new Error('Pass a read-only listener snapshot');
  const original = fs.readFileSync(snapshot, 'utf8');
  const patched = patchSource(original);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gainers-patch-'));
  try {
    const before = path.join(dir, 'before'), after = path.join(dir, 'after');
    fs.writeFileSync(before, original); fs.writeFileSync(after, patched);
    const result = child.spawnSync('diff', ['-U', '0', '--label', 'a/scripts/squawkbox-telegram-tdlib.mjs', '--label', 'b/scripts/squawkbox-telegram-tdlib.mjs', before, after], { encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw new Error('Could not generate patch');
    fs.writeFileSync(path.join(__dirname, 'telegram-listener-gainers.patch'), result.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { patchSource, addition, anchor };

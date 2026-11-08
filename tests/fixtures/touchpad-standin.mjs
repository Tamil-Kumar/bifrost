// A stand-in for Bifrost's touchpad watcher (assets/bin/touchpad-<arch>.exe, tools/win/touchpad.c) in tests: says
// "touchpads 1", then whatever is written to the file named in BIFROST_TOUCHPAD_CTL ("fingers 2" and so on), and
// exits when its stdin closes, as the real one does.
import fs from 'node:fs';
const ctl = process.env.BIFROST_TOUCHPAD_CTL;
process.stdout.write('touchpads 1\n');
setInterval(() => {
  let text = '';
  try { text = fs.readFileSync(ctl, 'utf8'); fs.unlinkSync(ctl); } catch { return; }
  process.stdout.write(text);
}, 20);
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

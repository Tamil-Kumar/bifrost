'use strict';
// Netscape bookmark files (the HTML every browser imports and exports).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
  });
}
function encode(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function attr(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? decode(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]) : '';
}

// Returns [{ title, url?, children?, separator?, dateAdded?, toolbar? }].
function parse(html) {
  const root = { children: [] };
  const stack = [root];
  let pendingFolder = null;
  const re = /<(\/?)(dl|h3|a|hr)\b([^>]*)>|<\/(h3|a)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const close = m[1] === '/';
    const tag = (m[2] || '').toLowerCase();
    const cur = stack[stack.length - 1];
    if (tag === 'h3' && !close) {
      const end = html.toLowerCase().indexOf('</h3>', re.lastIndex);
      const title = decode(html.slice(re.lastIndex, end < 0 ? re.lastIndex : end).replace(/<[^>]*>/g, '').trim());
      pendingFolder = { title, children: [], dateAdded: Number(attr(m[3], 'add_date')) * 1000 || undefined, toolbar: /personal_toolbar_folder\s*=\s*"?true/i.test(m[3]) };
      cur.children.push(pendingFolder);
      if (end >= 0) re.lastIndex = end + 5;
    } else if (tag === 'dl' && !close) {
      // A list right after a folder heading holds that folder's contents; the first list is the root.
      if (pendingFolder) { stack.push(pendingFolder); pendingFolder = null; }
    } else if (tag === 'dl' && close) {
      if (stack.length > 1) stack.pop();
    } else if (tag === 'a' && !close) {
      const end = html.toLowerCase().indexOf('</a>', re.lastIndex);
      const title = decode(html.slice(re.lastIndex, end < 0 ? re.lastIndex : end).replace(/<[^>]*>/g, '').trim());
      const url = attr(m[3], 'href');
      if (url) cur.children.push({ title, url, dateAdded: Number(attr(m[3], 'add_date')) * 1000 || undefined });
      if (end >= 0) re.lastIndex = end + 4;
      pendingFolder = null;
    } else if (tag === 'hr') {
      cur.children.push({ separator: true });
    }
  }
  return root.children;
}

function exportHtml(tree) {
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const secs = (ms) => Math.floor((ms || Date.now()) / 1000);
  const walk = (nodes, depth) => {
    const pad = '    '.repeat(depth);
    for (const n of nodes) {
      if (n.type === 'separator') out.push(pad + '<HR>');
      else if (n.type === 'folder') {
        out.push(`${pad}<DT><H3 ADD_DATE="${secs(n.dateAdded)}" LAST_MODIFIED="${secs(n.dateModified)}"${n.role === 'bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${encode(n.title)}</H3>`);
        out.push(pad + '<DL><p>');
        walk(n.children || [], depth + 1);
        out.push(pad + '</DL><p>');
      } else if (n.url) {
        out.push(`${pad}<DT><A HREF="${encode(n.url)}" ADD_DATE="${secs(n.dateAdded)}">${encode(n.title)}</A>`);
      }
    }
  };
  walk((tree && tree.children) || [], 1);
  out.push('</DL><p>');
  return out.join('\n') + '\n';
}

module.exports = { parse, exportHtml, decode };

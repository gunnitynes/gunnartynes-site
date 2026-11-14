// Tiny Markdown renderer for plugin descriptions (shared by the site and the admin).
// Supports: ## / ### headings, "* " or "- " lists, paragraphs, **bold**, *italic*, [links](url).
(function (root) {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[^)\s:]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    return s;
  }
  function item(s) {
    // "**TERM**: text" becomes a term/definition pair
    const m = s.match(/^\*\*(.+?)\*\*[:.]?\s*(.*)$/);
    if (m && m[2]) return '<li><span class="term">' + inline(m[1]) + '</span><span class="def">' + inline(m[2]) + '</span></li>';
    return '<li><span class="def">' + inline(s) + '</span></li>';
  }
  function render(md) {
    const lines = (md || '').replace(/\r/g, '').split('\n');
    let out = '', para = [], list = [];
    const flushP = () => { if (para.length) { out += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
    const flushL = () => { if (list.length) { out += '<ul>' + list.map(item).join('') + '</ul>'; list = []; } };
    for (const raw of lines) {
      const line = raw.trim();
      let m;
      if (!line) { flushP(); flushL(); continue; }
      if ((m = line.match(/^(#{2,4})\s+(.*)$/))) { flushP(); flushL(); out += '<h3>' + inline(m[2]) + '</h3>'; continue; }
      if ((m = line.match(/^[*-]\s+(.*)$/))) { flushP(); list.push(m[1]); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return out;
  }
  root.renderMarkdown = render;
  root.escapeHtml = esc;
})(window);

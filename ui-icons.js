(() => {
  const icons = {
    '↗': 'M7 17 17 7M8 7h9v9',
    '↘': 'M7 7 17 17M8 17h9V8',
    '→': 'M4 12h15m-6-6 6 6-6 6',
    '←': 'M20 12H5m6-6-6 6 6 6',
    '↑': 'M12 20V5m-6 6 6-6 6 6',
    '↓': 'M12 4v15m-6-6 6 6 6-6',
    '⬆': 'M12 20V5m-6 6 6-6 6 6',
    '▶': 'M8 5.5v13L19 12 8 5.5Z',
    '⌕': 'M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4ZM16 16l4.5 4.5',
    '⌘': 'M12 10V6.5a3 3 0 1 1 3 3H12Zm0 0h3.5a3 3 0 1 1-3.5 3V10Zm0 0v3.5a3 3 0 1 1-3-3.5H12Zm0 0H8.5a3 3 0 1 1 3.5-3V10Z',
    '＋': 'M12 5v14M5 12h14',
    '✦': 'm12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z',
    '✳': 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8m0-12.8L5.6 18.4',
    '★': 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
    '⭐': 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
    '☆': 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
    '♡': 'M20.8 8.6c0 5-8.8 10.1-8.8 10.1S3.2 13.6 3.2 8.6a4.6 4.6 0 0 1 8.8-2.8 4.6 4.6 0 0 1 8.8 2.8Z',
    '♥': 'M20.8 8.6c0 5-8.8 10.1-8.8 10.1S3.2 13.6 3.2 8.6a4.6 4.6 0 0 1 8.8-2.8 4.6 4.6 0 0 1 8.8 2.8Z'
  };
  const pattern = new RegExp(`[${Object.keys(icons).join('')}][\\uFE0E\\uFE0F]?`, 'g');

  function iconFor(glyph) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'ui-symbol-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icons[glyph]);
    if (glyph === '♥' || glyph === '★' || glyph === '⭐' || glyph === '▶') path.setAttribute('class', 'ui-symbol-icon__filled');
    icon.append(path);
    return icon;
  }

  function replaceText(node) {
    if (!node.isConnected) return;
    const matches = node.nodeValue.match(pattern);
    if (!matches) return;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,textarea,input,svg,[data-no-icon-replace]')) return;
    const fragment = document.createDocumentFragment();
    const pieces = node.nodeValue.split(pattern);
    pieces.forEach((piece, index) => {
      if (piece) fragment.append(document.createTextNode(piece));
      const glyph = matches[index]?.replace(/[\uFE0E\uFE0F]/g, '');
      if (glyph) fragment.append(iconFor(glyph));
    });
    node.replaceWith(fragment);
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      replaceText(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceText);
  }

  scan(document);
  new MutationObserver(records => records.forEach(record => {
    record.addedNodes.forEach(scan);
    if (record.type === 'characterData') scan(record.target);
  })).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();

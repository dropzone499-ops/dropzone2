(() => {
  const script = document.currentScript;
  if (!script) throw new Error('Shared layout script context is unavailable.');

  const root = new URL('.', script.src);
  const href = path => new URL(path, root).href;
  const pagePath = new URL(location.href).pathname.toLowerCase();
  const activePage = pagePath.endsWith('/sponsors.html') ? 'sponsors'
    : pagePath.endsWith('/about/index.html') ? 'about'
      : pagePath.endsWith('/contact/index.html') ? 'upload'
        : pagePath.endsWith('/contact.html') ? 'contact'
          : pagePath.endsWith('/admin.html') ? 'admin'
            : pagePath.endsWith('/terms.html') || pagePath.endsWith('/refund-policy.html') ? 'legal'
              : 'home';
  const nav = [
    ['home', 'მთავარი', 'index.html'],
    ['brands', 'ბრენდები', 'index.html#brands'],
    ['sponsors', 'სპონსორები', 'sponsors.html'],
    ['about', 'ჩვენ შესახებ', 'about/index.html'],
    ['contact', 'კონტაქტი', 'contact.html'],
    ['upload', 'განათავსე ნივთი', 'contact/index.html']
  ];
  const navLinks = nav.map(([key, label, path]) => {
    const active = activePage === key;
    return `<a href="${href(path)}" data-nav="${key}"${active ? ' class="active" aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const brandMark = `<img class="brand-mark" src="${href('assets/dropzone-brand-round.png')}" alt="">`;
  const header = `<div class="shared-header">
    <div class="ticker" aria-label="პარტნიორის სიახლე"><div class="ticker-track" id="ticker-track"><span>DropZone-ის მთავარი პარტნიორია უცხო ენების უმაღლესი სკოლა ნინო</span><span>DropZone-ის მთავარი პარტნიორია უცხო ენების უმაღლესი სკოლა ნინო</span></div></div>
    <header class="site-header">
      <a class="brand" href="${href('index.html')}" aria-label="DropZone მთავარი"><span class="brand-icon">${brandMark}</span><span class="brand-name">DropZone</span></a>
      <nav class="main-nav" id="primary-navigation" aria-label="მთავარი ნავიგაცია">${navLinks}</nav>
      <div class="header-actions">
        <button class="icon-action" type="button" aria-label="შეტყობინებები" data-notifications-open data-shared-action="notifications"><svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9"/><path d="M10 21h4"/></svg><span class="notification-count" data-notification-count hidden>0</span></button>
        <button class="icon-action" id="favorites-toggle" type="button" aria-label="ფავორიტები" data-shared-action="favorites"><svg class="header-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.1-8.8 10.1S3.2 13.6 3.2 8.6a4.6 4.6 0 0 1 8.8-2.8 4.6 4.6 0 0 1 8.8 2.8Z"/></svg><span id="favorite-count">0</span></button>
        <button class="icon-action" id="cart-open" type="button" aria-label="კალათა" data-shared-action="cart"><svg class="cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8.5h11l-1 12h-9l-1-12Z"/><path d="M9 8.5a3 3 0 0 1 6 0"/></svg><span id="cart-count">0</span></button>
        <div class="language-picker" role="group" aria-label="ენის არჩევა"><button type="button" data-language="ka">GEO</button><button type="button" data-language="en">ENG</button><button type="button" data-language="ru">RUS</button></div>
        <button class="account-button" id="auth-open" type="button" aria-label="შესვლა / რეგისტრაცია" data-shared-action="login"><span class="account-label" data-i18n="შესვლა / რეგისტრაცია">შესვლა / რეგისტრაცია</span><svg class="account-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 19c.8-3.7 3-5.5 6.5-5.5s5.7 1.8 6.5 5.5"/></svg></button>
        <button class="balance-button" data-open-balance type="button" aria-label="ბალანსი" data-shared-action="balance"><span class="balance-dot"></span><span id="balance-label">ბალანსი: 0 ₾</span><span class="balance-plus" aria-hidden="true"><svg class="header-icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span></button>
        <button class="admin-logout-button" id="admin-logout" type="button" hidden>გამოსვლა</button>
      </div>
      <button class="menu-toggle" id="menu-toggle" type="button" aria-label="მენიუს გახსნა" aria-controls="primary-navigation" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="menu-line menu-line--top" d="M4 6h16"/><path class="menu-line menu-line--middle" d="M4 12h16"/><path class="menu-line menu-line--bottom" d="M4 18h16"/></svg></button>
    </header>
  </div>`;
  const footer = `<footer class="site-footer">
    <div class="footer-divider shell" aria-hidden="true"></div>
    <div class="footer-main shell">
      <div class="shared-footer-brand"><a class="brand" href="${href('index.html')}" aria-label="DropZone მთავარი"><span class="brand-icon">${brandMark}</span><span class="brand-name">DropZone</span></a><p>ადგილობრივი შემოქმედება,<br>რომელსაც საკუთარი ისტორია აქვს.</p><div class="shared-footer-stats" aria-label="DropZone-ის სტატისტიკა"><div><strong id="hero-artist-count">00+</strong><span>აქტიური ხელოვანი</span></div><div><strong>100%</strong><span>უსაფრთხო გარანტია</span></div><div><strong>3–5</strong><span>დღიანი მიწოდება</span></div></div></div>
      <div class="footer-links"><strong>აღმოაჩინე</strong><a href="${href('index.html')}">მთავარი</a><a href="${href('about/index.html')}">ჩვენ შესახებ</a><a href="${href('sponsors.html')}">სპონსორები</a><a href="${href('contact.html')}">კონტაქტი</a><a href="${href('contact/index.html')}">ნამუშევრის დამატება</a></div>
      <div class="footer-links"><strong>ინფორმაცია</strong><a href="${href('terms.html')}">წესები და პირობები</a><a href="${href('refund-policy.html')}">დაბრუნება და დავები</a><a href="${href('index.html?open=privacy')}">კონფიდენციალურობა</a></div>
      <div class="social-links"><strong>გამოგვყევი</strong><a href="https://www.instagram.com/dropzone_122?jplx=MTVkd3Nmb3drMnV3Zg%3D%3D&amp;utm_source=qr" target="_blank" rel="noopener noreferrer">Instagram <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a><a href="https://www.facebook.com/" target="_blank" rel="noopener noreferrer">Facebook <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a></div>
    </div>
    <div class="footer-bottom shell"><span>© 2026 DropZone Market</span><span>შექმნილია ადგილობრივი ხელოვანებისა და მცირე ბიზნესისთვის.</span><a class="back-to-top" href="#top" aria-label="გვერდის დასაწყისში"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></a></div>
  </footer>`;

  const headerHolder = document.createElement('template');
  headerHolder.innerHTML = header;
  const headerNode = headerHolder.content.firstElementChild;
  const headerPlaceholder = document.getElementById('shared-header');
  const oldTicker = document.querySelector('.ticker');
  const oldHeader = document.querySelector('header.site-header');
  if (headerPlaceholder) headerPlaceholder.replaceWith(headerNode);
  else if (oldTicker) oldTicker.replaceWith(headerNode);
  else if (oldHeader) oldHeader.before(headerNode);
  else document.body.prepend(headerNode);
  document.querySelectorAll('.ticker, header.site-header').forEach(node => {
    if (!node.closest('.shared-header')) node.remove();
  });

  const footerHolder = document.createElement('template');
  footerHolder.innerHTML = footer;
  const footerNode = footerHolder.content.firstElementChild;
  const footerPlaceholder = document.getElementById('shared-footer');
  const oldFooter = document.querySelector('footer.site-footer');
  if (footerPlaceholder) footerPlaceholder.replaceWith(footerNode);
  else if (oldFooter) oldFooter.replaceWith(footerNode);
  else {
    const modalRoot = document.getElementById('modal-root');
    document.body.insertBefore(footerNode, modalRoot || null);
  }
  document.querySelectorAll('.legal-footer').forEach(node => node.remove());
  document.body.id ||= 'top';

  const hasApp = Array.from(document.scripts).some(item => /(?:^|\/)app\.js(?:[?#]|$)/.test(item.src));
  document.addEventListener('click', event => {
    const toggle = event.target.closest('#menu-toggle');
    if (toggle && !hasApp) {
      const navigation = document.getElementById('primary-navigation');
      const isOpen = navigation.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'მენიუს დახურვა' : 'მენიუს გახსნა');
      return;
    }

    const action = event.target.closest('[data-shared-action]');
    if (action && !hasApp) {
      event.preventDefault();
      const destination = new URL('index.html', root);
      destination.searchParams.set('open', action.dataset.sharedAction);
      location.assign(destination.href);
    }
  });
})();

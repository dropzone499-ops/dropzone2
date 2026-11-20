(() => {
  const api = window.DropZoneFirebase;
  const featuredRoot = document.getElementById('featured-partner-content');
  const sponsorsRoot = document.getElementById('sponsor-grid');
  const defaultPartnerName = 'უცხო ენების უმაღლესი სკოლა ნინო';
  let partner = {
    partnerName: defaultPartnerName,
    partnerDescription: '',
    partnerWebsiteUrl: '',
    partnerLogoUrl: ''
  };
  let sponsors = [];

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function safeLink(value) {
    try {
      const url = new URL(String(value || ''));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function featuredSponsor() {
    return sponsors.find(item => item.name === partner.partnerName)
      || sponsors.find(item => item.name === defaultPartnerName);
  }

  function renderFeatured() {
    const sponsor = featuredSponsor();
    const name = sponsor?.name || partner.partnerName || defaultPartnerName;
    const description = partner.partnerDescription || sponsor?.description || 'მადლობა მხარდაჭერისა და პარტნიორობისთვის.';
    const logoUrl = partner.partnerLogoUrl || sponsor?.logoUrl || 'assets/nino-school-logo.png';
    const websiteUrl = safeLink(partner.partnerWebsiteUrl || sponsor?.websiteUrl);
    const image = logoUrl
      ? `<img class="featured-partner-logo" src="${escapeHTML(logoUrl)}" alt="${escapeHTML(name)}">`
      : '';
    const title = `<h2 id="featured-partner-title">${escapeHTML(name)}</h2>`;
    const content = `<div class="featured-partner-content">${image}<div>${title}<p>${escapeHTML(description)}</p>${websiteUrl ? `<a class="button button-primary sponsor-visit" href="${escapeHTML(websiteUrl)}" target="_blank" rel="noopener noreferrer" ${sponsor ? `data-sponsor-click="${escapeHTML(sponsor.id)}"` : ''}>გაიგე მეტი <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : ''}</div></div>`;
    featuredRoot.innerHTML = content;
  }

  function renderSponsors() {
    const otherSponsors = sponsors.filter(item => item.active === true && item.id !== featuredSponsor()?.id);
    sponsorsRoot.innerHTML = otherSponsors.length ? otherSponsors.map(item => {
      const url = safeLink(item.websiteUrl);
      const media = item.logoUrl
        ? `<img src="${escapeHTML(item.logoUrl)}" alt="${escapeHTML(item.name)}" loading="lazy">`
        : `<span class="sponsor-placeholder" aria-hidden="true">${escapeHTML(String(item.name || 'D').slice(0, 1).toUpperCase())}</span>`;
      return `<article class="sponsor-card">
        <div class="sponsor-card-mark">${media}<span class="sponsor-tier">${escapeHTML(item.tier || 'პარტნიორი')}</span></div>
        <div class="sponsor-card-copy"><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.description || '')}</p>
        <div class="sponsor-card-footer">${url ? `<a class="text-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" data-sponsor-click="${escapeHTML(item.id)}">ვებგვერდი <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : '<span class="sponsor-clicks">პარტნიორი</span>'}<span class="sponsor-clicks">${Number(item.clicks || 0)} ნახვა</span></div></div>
      </article>`;
    }).join('') : '<p class="demo-note">სხვა აქტიური სპონსორები მალე დაემატება.</p>';
  }

  function render() {
    renderFeatured();
    renderSponsors();
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-sponsor-click]');
    if (link && api) {
      api.trackSponsorClick(link.dataset.sponsorClick).catch(error => {
        console.error('Unable to count sponsor click.', error);
      });
    }
    const toggle = event.target.closest('.menu-toggle');
    if (toggle) {
      const nav = document.querySelector('.main-nav');
      const isOpen = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    }
  });

  if (!api) {
    sponsorsRoot.innerHTML = '<p class="demo-note">სპონსორების მონაცემები ვერ ჩაიტვირთა: Firebase-ის კონფიგურაცია აკლია.</p>';
    return;
  }

  api.subscribeSiteConfig(config => {
    partner = {
      partnerName: String(config.partnerName || defaultPartnerName),
      partnerDescription: String(config.partnerDescription || ''),
      partnerWebsiteUrl: String(config.partnerWebsiteUrl || ''),
      partnerLogoUrl: String(config.partnerLogoUrl || '')
    };
    const ticker = document.getElementById('ticker-track') || document.getElementById('sponsor-ticker-track');
    const tickerMessage = String(config.tickerMessage || `DropZone-ის მთავარი პარტნიორია ${partner.partnerName}`);
    if (ticker) ticker.innerHTML = `<span>${escapeHTML(tickerMessage)}</span><span>${escapeHTML(tickerMessage)}</span>`;
    render();
  }, error => {
    console.error('Unable to load public partner configuration.', error);
  });

  api.subscribeSponsors(items => {
    sponsors = items.filter(item => item.active === true);
    render();
  }, error => {
    console.error('Unable to load active sponsors.', error);
    sponsorsRoot.innerHTML = '<p class="demo-note">სპონსორების სია დროებით მიუწვდომელია.</p>';
  });
})();

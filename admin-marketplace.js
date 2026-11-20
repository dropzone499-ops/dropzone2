(() => {
  const api = window.DropZoneAdminApi;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const state = {
    transactions: [],
    orders: [],
    payouts: [],
    vendors: [],
    disputes: [],
    categories: [],
    tags: [],
    promoCodes: [],
    auditLogs: [],
    sponsors: [],
    ads: [],
    reports: [],
    unsubscribers: []
  };
  let started = false;
  let handlersInstalled = false;

  function dateValue(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateText(value) {
    return dateValue(value)?.toLocaleString('ka-GE') || '—';
  }

  function amount(value) {
    return `${Number(value || 0).toLocaleString('ka-GE', { maximumFractionDigits: 2 })} ₾`;
  }

  function reportError(error) {
    console.error('Admin marketplace operation failed.', error);
    const connection = document.getElementById('admin-connection');
    if (connection) connection.textContent = error.message || 'ოპერაცია ვერ შესრულდა.';
  }

  function adminReady() {
    return document.getElementById('admin-dashboard-content')?.hidden === false;
  }

  function subscribe(collection, key, rootId, renderer) {
    if (!api) return;
    const unsubscribe = api.subscribeAdminCollection(collection, items => {
      state[key] = items;
      renderer(document.getElementById(rootId));
    }, reportError);
    state.unsubscribers.push(unsubscribe);
  }

  function financeRows(root) {
    if (!root) return;
    const from = document.getElementById('finance-from')?.value;
    const to = document.getElementById('finance-to')?.value;
    const transactions = state.transactions.filter(item => {
      const date = dateValue(item.transactionDate || item.createdAt);
      return date && (!from || date >= new Date(`${from}T00:00:00`))
        && (!to || date <= new Date(`${to}T23:59:59.999`));
    });
    const summary = transactions.reduce((totals, item) => {
      totals.gmv += Number(item.gmv || 0);
      totals.net += Number(item.netRevenue || 0);
      totals.payout += Number(item.artistPayout || 0);
      return totals;
    }, { gmv: 0, net: 0, payout: 0 });
    const summaryRoot = document.getElementById('finance-summary');
    if (summaryRoot) summaryRoot.innerHTML = [
      ['GMV', summary.gmv], ['Net Revenue', summary.net], ['Payout', summary.payout]
    ].map(([label, value]) => `<p class="modal-lead">${label}<strong>${amount(value)}</strong></p>`).join('');
    root.innerHTML = transactions.length ? transactions.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.type)} · ${escape(item.description)}</strong>
      <small>ID: ${escape(item.id)}</small>
      <small>${escape(item.buyer)} · ${escape(item.method)} · ${dateText(item.transactionDate || item.createdAt)}</small>
      <small>GMV ${amount(item.gmv)} · Net ${amount(item.netRevenue)} · Artist ${amount(item.artistPayout)} · ${escape(item.payoutStatus || '')}</small>
      <div class="admin-row-actions">${item.type === 'sale' && !item.deliveredAt
        ? `<button class="admin-verify" type="button" data-mark-delivered="${escape(item.id)}">ჩაბარებულად მონიშვნა</button>`
        : ''}${item.payoutStatus === 'held' && dateValue(item.releaseAt) && dateValue(item.releaseAt) <= new Date()
          ? `<button class="admin-verify" type="button" data-release-payout="${escape(item.id)}">Hold-ის მოხსნა</button>`
          : ''}</div></div></article>`).join('')
      : '<p class="demo-note">არჩეულ პერიოდში ტრანზაქციები არ არის.</p>';
    renderPayouts(document.getElementById('admin-payouts'));
  }

  function renderPayouts(root) {
    if (!root) return;
    root.innerHTML = state.payouts.length ? state.payouts.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.vendorId)} · ${amount(item.amount)}</strong>
      <small>${escape(item.status)} · ${escape(item.bankReference || 'ბანკის ნომერი არ არის')} · ${dateText(item.createdAt)}</small>
      ${item.status === 'pending' ? `<label class="field-label">საბანკო გადარიცხვის ნომერი<input data-payout-reference="${escape(item.id)}" maxlength="120" required></label><button class="admin-verify" type="button" data-payout-mark-paid="${escape(item.id)}">გადარიცხულად მონიშვნა</button>` : ''}</div></article>`).join('')
      : '<p class="demo-note">Payout ჩანაწერი ჯერ არ არის.</p>';
  }

  function renderOrders(root) {
    if (!root) return;
    const labels = { pending: 'მოლოდინშია', shipped: 'გამოგზავნილია', delivered: 'ჩაბარებულია' };
    root.innerHTML = state.orders.length ? state.orders.map(order => {
      const status = labels[order.status] ? order.status : 'pending';
      const items = (order.items || []).map(item => `<span>${escape(item.name)} · ${amount(item.price)}</span>`).join('');
      const next = status === 'pending' ? 'shipped' : status === 'shipped' ? 'delivered' : '';
      const actionLabel = next === 'shipped' ? 'გამოგზავნილად მონიშვნა' : 'ჩაბარებულად მონიშვნა';
      return `<article class="admin-listing-row admin-order-row">
        <div class="admin-listing-info"><strong>შეკვეთა #${escape(order.id)} · ${amount(order.total)}</strong>
          <small>${escape(order.buyerName)} · ${escape(order.buyerEmail)} · ${escape(order.buyerPhone)}</small>
          <small>მისამართი: ${escape(order.deliveryAddress)}</small>
          <small>ხელოვანი: ${escape(order.sellerId)} · ${dateText(order.createdAt)} · <span class="order-status-badge status-${status}">${labels[status]}</span></small>
          <div class="admin-order-items">${items}</div>
          <small>სატესტო გადახდა — რეალური თანხა არ ჩამოჭრილა.</small>
          ${next ? `<button type="button" class="admin-verify" data-order-status="${escape(order.id)}" data-next-status="${next}">${actionLabel}</button>` : `<small>Escrow hold: ${dateText(order.releaseAt)} · ${escape(order.escrowStatus || '')}</small>`}
        </div>
      </article>`;
    }).join('') : '<p class="demo-note">შეკვეთები ჯერ არ არის.</p>';
  }

  function renderVendors(root) {
    if (!root) return;
    root.innerHTML = state.vendors.length ? state.vendors.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.firstName)} ${escape(item.lastName)} · ${escape(item.email)}</strong>
      <small>${escape(item.country)} · IBAN: ${escape(item.iban)} · ID: ${escape(item.identityNumber)}</small>
      <small>KYC: ${item.verified ? 'დამტკიცებულია' : 'მოლოდინში'} · ${item.blocked ? 'დაბლოკილია' : 'აქტიურია'} · VIP: ${escape(item.vipStatus || 'inactive')} / ${escape(item.vipExpiresAt || '—')}</small>
      <div class="admin-row-actions">
        <button class="admin-verify" type="button" data-vendor-verify="${escape(item.id)}">${item.verified ? 'ვერიფიკაცია განახლდეს' : 'Verify Vendor'}</button>
        <button class="admin-verify" type="button" data-vendor-vip="${escape(item.id)}">VIP 30 დღით ${item.vipStatus === 'suspended' ? 'განახლება' : 'მინიჭება'}</button>
        <button class="admin-delete" type="button" data-vendor-vip-suspend="${escape(item.id)}">VIP შეჩერება</button>
        <button class="admin-delete" type="button" data-vendor-block="${escape(item.id)}">${item.blocked ? 'განბლოკვა' : 'გამყიდველის დაბლოკვა'}</button>
      </div></div></article>`).join('')
      : '<p class="demo-note">KYC გამყიდველები ჯერ არ არის.</p>';
  }

  function renderDisputes(root) {
    if (!root) return;
    root.innerHTML = state.disputes.length ? state.disputes.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.reporter)} · ${escape(item.transactionId)}</strong>
      <small>${escape(item.reason)} · ${escape(item.status)} · ${dateText(item.createdAt)}</small>
      ${item.status === 'open' ? `<div class="admin-row-actions"><button class="admin-verify" type="button" data-dispute-resolve="${escape(item.id)}">დავის დახურვა</button><button class="admin-delete" type="button" data-dispute-refund="${escape(item.id)}">დაბრუნებულად აღრიცხვა</button></div>` : ''}</div></article>`).join('')
      : '<p class="demo-note">ღია დავა არ არის.</p>';
  }

  function renderTaxonomy() {
    const root = document.getElementById('admin-taxonomy');
    if (!root) return;
    const rows = [...state.categories.map(item => ({ ...item, collection: 'categories' })),
      ...state.tags.map(item => ({ ...item, collection: 'tags' }))];
    root.innerHTML = rows.length ? rows.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.collection === 'categories' ? 'კატეგორია' : 'ტეგი')}: ${escape(item.name)}</strong></div>
      <button class="admin-delete" type="button" data-taxonomy-delete="${escape(item.id)}" data-collection="${escape(item.collection)}">წაშლა</button></article>`).join('')
      : '<p class="demo-note">კატეგორია ან ტეგი ჯერ არ დამატებულა.</p>';
  }

  function renderPromos(root) {
    if (!root) return;
    root.innerHTML = state.promoCodes.length ? state.promoCodes.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.code)} · ${Number(item.discountPercent)}%</strong>
      <small>ვადა: ${escape(item.expiresAt)} · ${item.active ? 'აქტიურია' : 'გამორთულია'}</small></div>
      <button class="admin-delete" type="button" data-promo-delete="${escape(item.id)}">წაშლა</button></article>`).join('')
      : '<p class="demo-note">პრომო კოდი ჯერ არ შექმნილა.</p>';
  }

  function renderAudit(root) {
    if (!root) return;
    root.innerHTML = state.auditLogs.length ? state.auditLogs.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.action)} · ${escape(item.collection)} / ${escape(item.recordId)}</strong>
      <small>${escape(item.actor)} · ${dateText(item.createdAt)} · ${escape(JSON.stringify(item.details || {}))}</small></div></article>`).join('')
      : '<p class="demo-note">ჟურნალი ცარიელია.</p>';
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function renderSponsors(root) {
    if (!root) return;
    root.innerHTML = state.sponsors.length ? state.sponsors.map(item => `<article class="admin-listing-row">
      ${item.logoUrl ? `<img src="${escape(item.logoUrl)}" alt="">` : '<span class="admin-sponsor-placeholder">DZ</span>'}
      <div class="admin-listing-info"><strong>${escape(item.name)}</strong>
        <small>${escape(item.tier || 'partner')} · ${Number(item.clicks || 0)} clicks · ${item.active ? 'აქტიურია' : 'გამორთულია'}</small>
        <small>${escape(item.description || '')}</small>
        ${safeExternalUrl(item.websiteUrl) ? `<a class="text-link" href="${escape(safeExternalUrl(item.websiteUrl))}" target="_blank" rel="noopener noreferrer">ვებგვერდი</a>` : ''}
      </div>
      <div class="admin-row-actions"><button type="button" class="admin-verify" data-sponsor-toggle="${escape(item.id)}" data-active="${String(item.active === true)}">${item.active ? 'გამორთვა' : 'ჩართვა'}</button><button type="button" class="admin-delete" data-sponsor-delete="${escape(item.id)}">წაშლა</button></div>
    </article>`).join('') : '<p class="demo-note">სპონსორი ჯერ არ დამატებულა.</p>';
  }

  function renderAds(root) {
    if (!root) return;
    root.innerHTML = state.ads.length ? state.ads.map(item => `<article class="admin-listing-row">
      ${item.imageUrl ? `<img src="${escape(item.imageUrl)}" alt="">` : '<span class="admin-sponsor-placeholder">AD</span>'}
      <div class="admin-listing-info"><strong>${escape(item.title)}</strong>
        <small>${escape(item.placement)} · ${Number(item.clicks || 0)} clicks · ${item.active ? 'აქტიურია' : 'გამორთულია'}</small>
        <small>Boost: ${item.boostEnabled ? escape(item.promotionTier) : 'გამორთულია'} · პროდუქტი: ${escape(item.featuredProductId || '—')}</small>
        ${safeExternalUrl(item.linkUrl) ? `<a class="text-link" href="${escape(safeExternalUrl(item.linkUrl))}" target="_blank" rel="noopener noreferrer">ბმულის ნახვა</a>` : ''}
      </div>
      <div class="admin-row-actions"><button type="button" class="admin-verify" data-ad-toggle="${escape(item.id)}" data-active="${String(item.active === true)}">${item.active ? 'გამორთვა' : 'ჩართვა'}</button><button type="button" class="admin-verify" data-ad-boost="${escape(item.id)}">${item.boostEnabled ? 'Boost-ის მოხსნა' : 'Featured / Boost'}</button></div>
    </article>`).join('') : '<p class="demo-note">სარეკლამო ბანერი ჯერ არ შექმნილა.</p>';
  }

  function renderReports(root) {
    if (!root) return;
    root.innerHTML = state.reports.length ? state.reports.map(item => `<article class="admin-listing-row">
      <div class="admin-listing-info"><strong>${escape(item.type === 'user' ? 'მომხმარებლის რეპორტი' : 'პროდუქტის რეპორტი')} · ${escape(item.targetId)}</strong>
        <small>${escape(item.reason)} · ${escape(item.status || 'open')} · ${dateText(item.createdAt)}</small>
        <small>რეპორტიორი UID: ${escape(item.reporterUid)}</small>
        ${item.status === 'open' ? `<button type="button" class="admin-verify" data-report-close="${escape(item.id)}">განხილულია / დახურვა</button>` : ''}
      </div></article>`).join('') : '<p class="demo-note">რეპორტი არ არის.</p>';
  }

  function csvEscape(value) {
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const from = document.getElementById('finance-from')?.value;
    const to = document.getElementById('finance-to')?.value;
    const rows = state.transactions.filter(item => {
      const date = dateValue(item.transactionDate || item.createdAt);
      return date && (!from || date >= new Date(`${from}T00:00:00`))
        && (!to || date <= new Date(`${to}T23:59:59.999`));
    });
    const header = ['Transaction ID', 'Date', 'Buyer', 'Vendor ID', 'Description', 'Payment method', 'GMV', 'Net Revenue', 'Artist Payout'];
    const csv = [header, ...rows.map(item => [
      item.id, dateValue(item.transactionDate || item.createdAt)?.toISOString(), item.buyer,
      item.vendorId, item.description, item.method, item.gmv, item.netRevenue, item.artistPayout
    ])].map(row => row.map(csvEscape).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `dropzone-finance-${from || 'all'}-${to || 'all'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function commissionRate() {
    const value = Number(document.querySelector('#commission-form [name="commissionRate"]')?.value);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : 0;
  }

  async function createTransaction(form) {
    const data = Object.fromEntries(new FormData(form));
    const gross = Number(data.amount);
    if (!Number.isFinite(gross) || gross <= 0) throw new Error('თანხა უნდა იყოს დადებითი.');
    const rate = data.type === 'sale' ? commissionRate() : 0;
    const sign = data.type === 'refund' ? -1 : 1;
    const date = data.deliveredAt ? new Date(`${data.deliveredAt}T00:00:00`) : null;
    if (date && Number.isNaN(date.getTime())) throw new Error('მიწოდების თარიღი არასწორია.');
    await api.createAdminRecord('transactions', {
      type: data.type,
      buyer: String(data.buyer || '').trim(),
      vendorId: String(data.vendorId || '').trim(),
      description: String(data.description || '').trim(),
      method: String(data.method || '').trim(),
      gmv: sign * gross,
      netRevenue: sign * (data.type === 'sale' ? gross * rate : gross),
      artistPayout: sign * (data.type === 'sale' ? gross * (1 - rate) : 0),
      transactionDate: new Date().toISOString(),
      deliveredAt: date ? date.toISOString() : null,
      releaseAt: date ? new Date(date.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString() : null,
      payoutStatus: data.type !== 'sale' ? 'not-applicable' : date ? 'held' : 'pending-delivery'
    });
    form.reset();
  }

  function payoutBalance(vendorId, excludedPayoutId = '') {
    const disputedIds = new Set(state.disputes.filter(item => item.status === 'open').map(item => item.transactionId));
    const accrued = state.transactions.filter(item => item.vendorId === vendorId
      && item.payoutStatus === 'available' && !disputedIds.has(item.id))
      .reduce((sum, item) => sum + Number(item.artistPayout || 0), 0);
    const paid = state.payouts.filter(item => item.vendorId === vendorId && item.id !== excludedPayoutId
      && ['pending', 'paid'].includes(item.status))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return Math.max(0, accrued - paid);
  }

  async function createPayoutRequest(form) {
    const data = Object.fromEntries(new FormData(form));
    const value = Number(data.amount);
    const available = payoutBalance(String(data.vendorId || '').trim());
    if (!Number.isFinite(value) || value <= 0 || value > available) {
      throw new Error(`ხელმისაწვდომი თანხა: ${amount(available)}. მხოლოდ ესკრო-ვადის გასული თანხის გადარიცხვა შეიძლება.`);
    }
    await api.createAdminRecord('payouts', {
      vendorId: String(data.vendorId).trim(),
      amount: value,
      status: 'pending'
    });
    form.reset();
  }

  async function markPayoutPaid(id, bankReference) {
    const reference = String(bankReference || '').trim();
    if (!reference) throw new Error('საბანკო გადარიცხვის ნომერი აუცილებელია.');
    const payout = state.payouts.find(item => item.id === id && item.status === 'pending');
    if (!payout) throw new Error('მოლოდინის payout ვერ მოიძებნა.');
    const available = payoutBalance(payout.vendorId, id);
    if (Number(payout.amount) > available) {
      throw new Error('ესკრო თანხაზე დავა გაიხსნა ან ხელმისაწვდომი ბალანსი შეიცვალა.');
    }
    await api.updateAdminRecord('payouts', id, {
      status: 'paid',
      bankReference: reference,
      paidAt: new Date().toISOString()
    });
  }

  async function refundDispute(dispute) {
    const source = state.transactions.find(item => item.id === dispute.transactionId);
    if (!source || Number(source.gmv) <= 0) throw new Error('დაკავშირებული გაყიდვის ტრანზაქცია ვერ მოიძებნა.');
    await api.recordDisputeRefund(dispute.id, source.id);
  }

  function installHandlers() {
    if (handlersInstalled) return;
    handlersInstalled = true;
    document.addEventListener('submit', async event => {
      const form = event.target;
      if (!['transaction-form', 'payout-form', 'vendor-form', 'dispute-form', 'taxonomy-form', 'promo-form', 'sponsor-form', 'ad-form', 'site-config-form'].includes(form.id)) return;
      event.preventDefault();
      if (!adminReady()) return;
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        if (form.id === 'transaction-form') await createTransaction(form);
        if (form.id === 'payout-form') await createPayoutRequest(form);
        if (form.id === 'vendor-form') {
          const data = Object.fromEntries(new FormData(form));
          const record = {
            ...data,
            email: String(data.email).trim().toLowerCase(),
            iban: String(data.iban).replace(/\s/g, '').toUpperCase()
          };
          const existing = state.vendors.find(vendor => vendor.email === record.email);
          if (existing) await api.updateAdminRecord('vendors', existing.id, record);
          else await api.createAdminRecord('vendors', { ...record, verified: false, blocked: false, vipStatus: 'inactive' });
          form.reset();
        }
        if (form.id === 'dispute-form') {
          const data = Object.fromEntries(new FormData(form));
          await api.createAdminRecord('disputes', { ...data, status: 'open' });
          form.reset();
        }
        if (form.id === 'taxonomy-form') {
          const data = Object.fromEntries(new FormData(form));
          const name = String(data.name || '').trim();
          const exists = state[data.collection === 'categories' ? 'categories' : 'tags'].some(item => item.name.toLowerCase() === name.toLowerCase());
          if (!name || exists) throw new Error('სახელი ცარიელია ან უკვე არსებობს.');
          await api.createAdminRecord(data.collection, { name });
          form.reset();
        }
        if (form.id === 'promo-form') {
          const data = Object.fromEntries(new FormData(form));
          const code = String(data.code || '').trim().toUpperCase();
          const discountPercent = Number(data.discountPercent);
          if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 99) {
            throw new Error('პრომო კოდი ან ფასდაკლების პროცენტი არასწორია.');
          }
          if (state.promoCodes.some(item => item.code === code)) throw new Error('ეს კოდი უკვე არსებობს.');
          await api.createAdminRecord('promoCodes', { code, discountPercent, expiresAt: data.expiresAt, active: true });
          form.reset();
        }
        if (form.id === 'sponsor-form') {
          const data = new FormData(form);
          const file = form.elements.logo.files[0];
          const media = file ? await api.uploadAdminMedia(file, 'sponsors') : null;
          await api.createAdminRecord('sponsors', {
            name: String(data.get('name') || '').trim(),
            logoUrl: media?.url || '',
            storagePath: media?.path || '',
            description: String(data.get('description') || '').trim(),
            websiteUrl: safeExternalUrl(data.get('websiteUrl')),
            tier: String(data.get('tier') || 'partner'),
            active: data.has('active'),
            clicks: 0
          });
          form.reset();
          form.elements.active.checked = true;
        }
        if (form.id === 'ad-form') {
          const data = new FormData(form);
          const file = form.elements.image.files[0];
          if (!file) throw new Error('ბანერის სურათის ატვირთვა აუცილებელია.');
          const media = await api.uploadAdminMedia(file, 'ads');
          const linkUrl = safeExternalUrl(data.get('linkUrl'));
          if (!linkUrl) throw new Error('რეკლამის ბმული უნდა იყოს http ან https მისამართი.');
          await api.createAdminRecord('ads', {
            title: String(data.get('title') || '').trim(),
            imageUrl: media.url,
            storagePath: media.path,
            linkUrl,
            placement: String(data.get('placement') || 'catalog'),
            featuredProductId: String(data.get('featuredProductId') || '').trim(),
            promotionTier: String(data.get('promotionTier') || 'none'),
            boostEnabled: false,
            active: data.has('active'),
            clicks: 0
          });
          form.reset();
          form.elements.active.checked = true;
        }
        if (form.id === 'site-config-form') {
          const data = new FormData(form);
          const logo = form.elements.partnerLogo.files[0];
          const media = logo ? await api.uploadAdminMedia(logo, 'sponsors') : null;
          const updates = {
            partnerName: String(data.get('partnerName') || '').trim(),
            tickerMessage: String(data.get('tickerMessage') || '').trim(),
            partnerDescription: String(data.get('partnerDescription') || '').trim(),
            partnerWebsiteUrl: safeExternalUrl(data.get('partnerWebsiteUrl'))
          };
          if (media) updates.partnerLogoUrl = media.url;
          await api.saveAdminSiteConfig(updates);
          document.getElementById('site-config-message').textContent = 'საიტის პარამეტრები განახლდა.';
        }
      } catch (error) {
        reportError(error);
      } finally {
        if (submit) submit.disabled = false;
      }
    });

    document.addEventListener('click', async event => {
      const button = event.target.closest('[data-finance-export], [data-mark-delivered], [data-release-payout], [data-payout-mark-paid], [data-order-status], [data-vendor-verify], [data-vendor-vip], [data-vendor-vip-suspend], [data-vendor-block], [data-dispute-resolve], [data-dispute-refund], [data-taxonomy-delete], [data-promo-delete], [data-sponsor-toggle], [data-sponsor-delete], [data-ad-toggle], [data-ad-boost], [data-report-close]');
      if (!button || !adminReady()) return;
      if (button.hasAttribute('data-finance-export')) { exportCsv(); return; }
      button.disabled = true;
      try {
        if (button.dataset.markDelivered) {
          const releaseAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
          await api.updateAdminRecord('transactions', button.dataset.markDelivered, {
            deliveredAt: new Date().toISOString(),
            releaseAt: releaseAt.toISOString(),
            payoutStatus: 'held'
          });
        }
        if (button.dataset.releasePayout) {
          const item = state.transactions.find(transaction => transaction.id === button.dataset.releasePayout);
          const disputed = state.disputes.some(dispute => dispute.transactionId === item?.id && dispute.status === 'open');
          if (!item || !item.releaseAt || dateValue(item.releaseAt) > new Date() || disputed) {
            throw new Error('Escrow ვადა არ გასულა ან ტრანზაქციაზე ღია დავაა.');
          }
          await api.updateAdminRecord('transactions', item.id, { payoutStatus: 'available' });
        }
        if (button.dataset.payoutMarkPaid) {
          const input = button.closest('.admin-listing-info')?.querySelector('[data-payout-reference]');
          await markPayoutPaid(button.dataset.payoutMarkPaid, input?.value);
        }
        if (button.dataset.orderStatus) {
          await api.updateOrderStatus(button.dataset.orderStatus, button.dataset.nextStatus);
        }
        if (button.dataset.vendorVerify) {
          const item = state.vendors.find(vendor => vendor.id === button.dataset.vendorVerify);
          if (item) await api.approveVendor(item.id, { firstName: item.firstName, lastName: item.lastName, email: item.email, iban: item.iban, country: item.country, identityNumber: item.identityNumber });
        }
        if (button.dataset.vendorVip) {
          await api.updateAdminRecord('vendors', button.dataset.vendorVip, {
            vipStatus: 'active',
            vipExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          });
        }
        if (button.dataset.vendorVipSuspend) await api.updateAdminRecord('vendors', button.dataset.vendorVipSuspend, { vipStatus: 'suspended' });
        if (button.dataset.vendorBlock) {
          const vendor = state.vendors.find(item => item.id === button.dataset.vendorBlock);
          if (!vendor) throw new Error('გამყიდველი ვერ მოიძებნა.');
          await api.setVendorBlocked(vendor.id, !vendor.blocked);
        }
        if (button.dataset.disputeResolve) await api.updateAdminRecord('disputes', button.dataset.disputeResolve, { status: 'resolved', resolvedAt: new Date().toISOString() });
        if (button.dataset.disputeRefund) {
          const dispute = state.disputes.find(item => item.id === button.dataset.disputeRefund);
          if (!dispute) throw new Error('დავა ვერ მოიძებნა.');
          await refundDispute(dispute);
        }
        if (button.dataset.taxonomyDelete) await api.deleteAdminRecord(button.dataset.collection, button.dataset.taxonomyDelete);
        if (button.dataset.promoDelete) await api.deleteAdminRecord('promoCodes', button.dataset.promoDelete);
        if (button.dataset.sponsorToggle) {
          await api.updateAdminRecord('sponsors', button.dataset.sponsorToggle, { active: button.dataset.active !== 'true' });
        }
        if (button.dataset.sponsorDelete) await api.deleteAdminRecord('sponsors', button.dataset.sponsorDelete);
        if (button.dataset.adToggle) {
          await api.updateAdminRecord('ads', button.dataset.adToggle, { active: button.dataset.active !== 'true' });
        }
        if (button.dataset.adBoost) {
          const ad = state.ads.find(item => item.id === button.dataset.adBoost);
          if (!ad) throw new Error('რეკლამა ვერ მოიძებნა.');
          const enable = !ad.boostEnabled;
          const productId = String(ad.featuredProductId || '').trim();
          const tier = String(ad.promotionTier || 'none');
          if (productId && tier !== 'none') {
            await api.updateProduct(productId, {
              promotion: enable ? tier : 'free',
              featured: enable,
              promotedByAd: enable ? ad.id : ''
            });
          } else if (enable) {
            throw new Error('Boost-ისთვის მიუთითე Featured პროდუქტის ID და Boost დონე.');
          }
          await api.updateAdminRecord('ads', ad.id, { boostEnabled: enable });
        }
        if (button.dataset.reportClose) {
          await api.updateAdminRecord('reports', button.dataset.reportClose, {
            status: 'closed',
            resolvedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        reportError(error);
      } finally {
        button.disabled = false;
      }
    });

    ['finance-from', 'finance-to'].forEach(id => document.getElementById(id)?.addEventListener('change', () => financeRows(document.getElementById('admin-transactions'))));
  }

  function start() {
    if (started || !api || !adminReady()) return;
    started = true;
    try {
      subscribe('transactions', 'transactions', 'admin-transactions', financeRows);
      subscribe('payouts', 'payouts', 'admin-payouts', renderPayouts);
      api.subscribeAdminOrders(items => {
        state.orders = items;
        renderOrders(document.getElementById('admin-orders'));
      }, reportError).then(unsubscribe => {
        if (started) state.unsubscribers.push(unsubscribe);
        else unsubscribe();
      }).catch(reportError);
      subscribe('vendors', 'vendors', 'admin-vendors', renderVendors);
      subscribe('disputes', 'disputes', 'admin-disputes', renderDisputes);
      subscribe('categories', 'categories', 'admin-taxonomy', renderTaxonomy);
      subscribe('tags', 'tags', 'admin-taxonomy', renderTaxonomy);
      subscribe('promoCodes', 'promoCodes', 'admin-promos', renderPromos);
      subscribe('auditLogs', 'auditLogs', 'admin-audit', renderAudit);
      subscribe('sponsors', 'sponsors', 'admin-sponsors', renderSponsors);
      subscribe('ads', 'ads', 'admin-ads', renderAds);
      subscribe('reports', 'reports', 'admin-reports', renderReports);
      const unsubscribeSiteConfig = api.subscribeSiteConfig(config => {
        const form = document.getElementById('site-config-form');
        if (!form) return;
        form.elements.partnerName.value = config.partnerName || 'უცხო ენების უმაღლესი სკოლა ნინო';
        form.elements.tickerMessage.value = config.tickerMessage || 'DropZone მხარს უჭერს უცხო ენების უმაღლეს სკოლა ნინოს — ჩვენს მთავარ პარტნიორს.';
        form.elements.partnerDescription.value = config.partnerDescription || '';
        form.elements.partnerWebsiteUrl.value = config.partnerWebsiteUrl || '';
      }, reportError);
      state.unsubscribers.push(unsubscribeSiteConfig);
      installHandlers();
    } catch (error) {
      stop();
      reportError(error);
    }
  }

  function stop() {
    state.unsubscribers.forEach(unsubscribe => unsubscribe());
    state.unsubscribers = [];
    started = false;
  }

  document.addEventListener('dropzone-admin-ready', start);
  document.addEventListener('dropzone-admin-logout', stop);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

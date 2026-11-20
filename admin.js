const adminApi = window.DropZoneAdminApi;
const pendingRoot = document.getElementById('admin-pending-products');
const allProductsRoot = document.getElementById('admin-all-products');
const paymentsRoot = document.getElementById('admin-payments');
const usersRoot = document.getElementById('admin-users');
const usersSearch = document.getElementById('admin-users-search');
const usersFilter = document.getElementById('admin-users-filter');
const usersMessage = document.getElementById('admin-users-message');
const connectionLabel = document.getElementById('admin-connection');
const commissionForm = document.getElementById('commission-form');
const pinCard = document.getElementById('admin-pin-card');
const pinForm = document.getElementById('admin-pin-form');
const pinMessage = document.getElementById('admin-pin-message');
const dashboardContent = document.getElementById('admin-dashboard-content');
const logoutButton = document.getElementById('admin-logout');
let remoteProducts = [];
let remotePayments = [];
let remoteUsers = [];
let adminProductsUnsubscribe = null;
let adminPaymentsUnsubscribe = null;
let adminUsersUnsubscribe = null;
let adminSettingsUnsubscribe = null;
let adminPinVerified = false;
let adminPinExpiryTimer = null;
let adminPinExpiresAt = 0;

function stopAdminDataSubscriptions() {
  [adminProductsUnsubscribe, adminPaymentsUnsubscribe, adminUsersUnsubscribe, adminSettingsUnsubscribe]
    .forEach(unsubscribe => unsubscribe?.());
  adminProductsUnsubscribe = null;
  adminPaymentsUnsubscribe = null;
  adminUsersUnsubscribe = null;
  adminSettingsUnsubscribe = null;
}

function acceptAdminPinSession(expiresAt) {
  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('PIN სესია ვადაგასულია. შეიყვანე PIN ხელახლა.');
  pinCard.hidden = true;
  adminPinVerified = true;
  adminPinExpiresAt = expiry;
  clearTimeout(adminPinExpiryTimer);
  adminPinExpiryTimer = window.setTimeout(lockAdminPinSession, expiry - Date.now());
  startAdminDashboard();
}

function lockAdminPinSession() {
  if (!adminPinVerified) return;
  adminPinVerified = false;
  adminPinExpiresAt = 0;
  clearTimeout(adminPinExpiryTimer);
  adminPinExpiryTimer = null;
  pinCard.hidden = false;
  dashboardContent.hidden = true;
  logoutButton.hidden = true;
  dashboardContent.dataset.authenticated = 'false';
  document.dispatchEvent(new Event('dropzone-admin-logout'));
  pinMessage.textContent = 'PIN სესია დასრულდა. გასაგრძელებლად შეიყვანე PIN ხელახლა.';
  stopAdminDataSubscriptions();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && adminPinVerified && Date.now() >= adminPinExpiresAt) {
    lockAdminPinSession();
  }
});

document.addEventListener('dropzone-admin-session-expired', () => {
  lockAdminPinSession();
  pinMessage.textContent = 'PIN სესია ვადაგასულია. შედი თავიდან.';
});

commissionForm.elements.commissionRate.value = '12';

function escapeAdminHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function products() {
  return remoteProducts;
}

function productMarkup(product) {
  const id = escapeAdminHTML(product.id);
  const status = product.approvalStatus || 'Approved';
  const mediaUrl = product.mediaUrl || product.image || '';
  const media = product.mediaType === 'video'
    ? `<video src="${escapeAdminHTML(mediaUrl)}" controls muted playsinline></video>`
    : `<img src="${escapeAdminHTML(mediaUrl)}" alt="">`;
  const actions = `<div class="admin-row-actions">
    ${status === 'Pending' ? `<button type="button" class="admin-verify" data-approve="${id}">დამტკიცება / Approve</button><button type="button" class="admin-delete" data-reject="${id}">უარყოფა / Reject</button>` : ''}
    <button type="button" class="admin-delete" data-delete="${id}">წაშლა / Delete</button>
  </div>`;
  return `<article class="admin-listing-row" data-product-id="${id}">
    ${media}
    <div class="admin-listing-info">
      <strong>${escapeAdminHTML(product.name)}</strong>
      <small>${escapeAdminHTML(product.seller || product.brand || '')} · ${escapeAdminHTML(product.price)} ₾ · ${escapeAdminHTML(status)}</small>
      <small>${escapeAdminHTML(product.description || '')}</small>
      ${actions}
    </div>
  </article>`;
}

function renderProducts() {
  const all = products();
  const pending = all.filter(product => product.approvalStatus === 'Pending');
  document.getElementById('pending-count').textContent = String(pending.length);
  document.getElementById('all-products-count').textContent = String(all.length);
  pendingRoot.innerHTML = pending.length
    ? pending.map(productMarkup).join('')
    : '<p class="demo-note">მოლოდინში მყოფი პროდუქტი არ არის.</p>';
  allProductsRoot.innerHTML = all.length
    ? all.map(productMarkup).join('')
    : '<p class="demo-note">პროდუქტი ჯერ არ არის.</p>';
}

function paymentMarkup(request) {
  const id = escapeAdminHTML(request.id);
  const status = String(request.status || 'pending');
  const transaction = request.transactionId || request.orderId || request.reference || request.id;
  const iban = request.iban || request.recipientIban || '—';
  const actions = status === 'pending'
    ? `<div class="admin-payment-actions">
        <button class="admin-verify" type="button" data-payment-action="approved" data-payment-id="${id}">დადასტურება</button>
        <button class="admin-delete" type="button" data-payment-action="rejected" data-payment-id="${id}">უარყოფა</button>
      </div>`
    : `<small>${escapeAdminHTML(status === 'approved' ? 'დადასტურებულია' : 'უარყოფილია')}</small>`;
  return `<article class="admin-payment-row">
    <div>
      <strong>ტრანზაქცია: ${escapeAdminHTML(transaction)}</strong>
      <small>${escapeAdminHTML(request.email || '')} · ${escapeAdminHTML(request.type || 'ბალანსის შევსება')}</small>
      <small>IBAN: ${escapeAdminHTML(iban)}</small>
      <small>${escapeAdminHTML(request.date || request.createdAt || '')}</small>
    </div>
    <span>${escapeAdminHTML(request.amount)} ₾</span>
    ${actions}
  </article>`;
}

function renderPayments() {
  paymentsRoot.innerHTML = remotePayments.length
    ? remotePayments.map(paymentMarkup).join('')
    : '<p class="demo-note">გადახდის ან ბალანსის მოთხოვნა არ არის.</p>';
}

function userDateLabel(value) {
  if (!value) return '—';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ka-GE');
}

function userMarkup(user) {
  const id = escapeAdminHTML(user.id);
  const collection = escapeAdminHTML(user.profileCollection);
  const banned = user.banned === true;
  const verified = user.verified === true;
  const vip = user.vip === true;
  const role = user.role === 'business' ? 'ხელოვანი / მაღაზია' : 'მყიდველი / კერძო პირი';
  return `<article class="admin-user-card">
    <div class="admin-user-details">
      <strong>${escapeAdminHTML(user.name || 'უსახელო მომხმარებელი')}</strong>
      <small>${escapeAdminHTML(user.email || 'ელ-ფოსტა მითითებული არ არის')}</small>
      <small>${escapeAdminHTML(role)} · რეგისტრაცია: ${escapeAdminHTML(userDateLabel(user.createdAt))}</small>
      <div class="admin-user-statuses">
        <span class="${banned ? 'is-banned' : 'is-active'}">${banned ? 'დაბლოკილი' : 'აქტიური'}</span>
        ${verified ? '<span>ვერიფიცირებული</span>' : ''}
        ${vip ? '<span>VIP</span>' : ''}
        ${user.bonusTier && user.bonusTier !== 'none' ? `<span>Bonus ${escapeAdminHTML(user.bonusTier)}</span>` : ''}
        ${Number(user.freeBoosts || 0) > 0 ? `<span>${Number(user.freeBoosts)} უფასო Boost</span>` : ''}
      </div>
    </div>
    <div class="admin-user-actions">
      <button type="button" class="admin-verify" data-user-action="verified" data-user-id="${id}" data-user-collection="${collection}" data-user-value="${!verified}">${verified ? 'ვერიფიკაციის მოხსნა' : 'ვერიფიკაცია'}</button>
      <button type="button" class="admin-verify" data-user-action="vip" data-user-id="${id}" data-user-collection="${collection}" data-user-value="${!vip}">${vip ? 'VIP-ის მოხსნა' : 'VIP მინიჭება'}</button>
      <button type="button" class="admin-delete" data-user-action="banned" data-user-id="${id}" data-user-collection="${collection}" data-user-value="${!banned}">${banned ? 'განბლოკვა' : 'დაბლოკვა'}</button>
    </div>
    ${user.role === 'business' && user.profileCollection === 'users' ? `<form class="admin-bonus-form" data-user-id="${id}" data-user-collection="${collection}">
      <label class="field-label">ბონუსის დონე<select name="bonusTier"><option value="none" ${!user.bonusTier || user.bonusTier === 'none' ? 'selected' : ''}>None</option><option value="bronze" ${user.bonusTier === 'bronze' ? 'selected' : ''}>Bronze</option><option value="silver" ${user.bonusTier === 'silver' ? 'selected' : ''}>Silver</option><option value="gold" ${user.bonusTier === 'gold' ? 'selected' : ''}>Gold</option></select></label>
      <label class="field-label">უფასო Boost<input name="freeBoosts" type="number" min="0" max="100" step="1" value="${Number(user.freeBoosts || 0)}"></label>
      <label class="field-label">საკომისიოს შეღავათი (%)<input name="commissionDiscount" type="number" min="0" max="100" step="0.1" value="${Number(user.commissionDiscount || 0)}"></label>
      <button type="button" class="admin-verify" data-user-bonus>ბონუსის შენახვა</button>
    </form>` : ''}
  </article>`;
}

function renderUsers() {
  const query = String(usersSearch.value || '').trim().toLocaleLowerCase();
  const filter = usersFilter.value;
  const filtered = remoteUsers.filter(user => {
    const matchesText = `${user.name || ''} ${user.email || ''}`.toLocaleLowerCase().includes(query);
    const matchesFilter = filter === 'artists'
      ? user.role === 'business'
      : filter === 'banned' ? user.banned === true : true;
    return matchesText && matchesFilter;
  });
  document.getElementById('admin-users-count').textContent = String(remoteUsers.length);
  usersRoot.innerHTML = filtered.length
    ? filtered.map(userMarkup).join('')
    : '<p class="demo-note">მომხმარებელი ამ ფილტრით ვერ მოიძებნა.</p>';
}

function showAuthenticatedDashboard() {
  if (!adminPinVerified) return;
  dashboardContent.hidden = false;
  logoutButton.hidden = false;
  connectionLabel.textContent = window.DropZoneAdminMode === 'test'
    ? 'ლოკალური სატესტო რეჟიმი · მონაცემები დროებითია'
    : 'ადმინისტრატორი ავტორიზებულია · სერვერული PIN';
  dashboardContent.dataset.authenticated = 'true';
  document.dispatchEvent(new Event('dropzone-admin-ready'));
}

function handleAdminApiError(error) {
  console.error('Admin API request failed.', error);
  if (error.status === 401) {
    lockAdminPinSession();
    pinMessage.textContent = error.message || 'PIN სესია ვადაგასულია. შედი თავიდან.';
    return;
  }
  connectionLabel.textContent = error.message || 'ადმინისტრაციული მონაცემები ვერ ჩაიტვირთა.';
}

async function updateProduct(id, status) {
  const product = products().find(item => String(item.id) === String(id));
  if (!product) throw new Error('პროდუქტი ვერ მოიძებნა.');
  if (status === 'Deleted') await adminApi.deleteProduct(id);
  else await adminApi.updateProduct(id, { approvalStatus: status, reviewedAt: new Date().toISOString() });
}

document.querySelector('.admin-tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-admin-tab]');
  if (!tab) return;
  document.querySelectorAll('[data-admin-tab]').forEach(button => {
    const active = button === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.admin-tab-panel').forEach(panel => {
    panel.hidden = panel.id !== tab.dataset.adminTab;
  });
});

document.querySelectorAll('#admin-pending-products, #admin-all-products').forEach(root => {
  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-approve], [data-reject], [data-delete]');
    if (!button) return;
    const id = button.dataset.approve || button.dataset.reject || button.dataset.delete;
    const status = button.hasAttribute('data-delete') ? 'Deleted' : button.hasAttribute('data-reject') ? 'Rejected' : 'Approved';
    button.disabled = true;
    try {
      await updateProduct(id, status);
      renderProducts();
    } catch (error) {
      console.error('Unable to update product.', error);
      button.disabled = false;
      connectionLabel.textContent = error.message || 'პროდუქტის განახლება ვერ მოხერხდა.';
    }
  });
});

paymentsRoot.addEventListener('click', async event => {
  const button = event.target.closest('[data-payment-action]');
  if (!button) return;
  const status = button.dataset.paymentAction;
  button.disabled = true;
  try {
    await adminApi.updateAdminPayment(button.dataset.paymentId, status);
  } catch (error) {
    console.error('Unable to review payment request.', error);
    button.disabled = false;
    connectionLabel.textContent = error.message || 'გადახდის მოთხოვნის განახლება ვერ მოხერხდა.';
  }
});

usersSearch.addEventListener('input', renderUsers);
usersFilter.addEventListener('change', renderUsers);
usersRoot.addEventListener('click', async event => {
  const bonusButton = event.target.closest('[data-user-bonus]');
  if (bonusButton) {
    const form = bonusButton.closest('.admin-bonus-form');
    const data = Object.fromEntries(new FormData(form));
    const freeBoosts = Number(data.freeBoosts);
    const commissionDiscount = Number(data.commissionDiscount);
    if (!Number.isInteger(freeBoosts) || freeBoosts < 0 || freeBoosts > 100
      || !Number.isFinite(commissionDiscount) || commissionDiscount < 0 || commissionDiscount > 100) {
      usersMessage.textContent = 'ბონუსის მნიშვნელობები არასწორია.';
      return;
    }
    bonusButton.disabled = true;
    try {
      await adminApi.updateAdminUser(form.dataset.userId, form.dataset.userCollection, {
        bonusTier: data.bonusTier,
        freeBoosts,
        commissionDiscount
      });
      usersMessage.textContent = 'გამყიდველის ბონუსი განახლდა.';
    } catch (error) {
      console.error('Unable to update seller bonus.', error);
      usersMessage.textContent = error.message || 'ბონუსის განახლება ვერ მოხერხდა.';
      bonusButton.disabled = false;
    }
    return;
  }
  const button = event.target.closest('[data-user-action]');
  if (!button) return;
  button.disabled = true;
  usersMessage.textContent = '';
  try {
    await adminApi.updateAdminUser(
      button.dataset.userId,
      button.dataset.userCollection,
      { [button.dataset.userAction]: button.dataset.userValue === 'true' }
    );
    usersMessage.textContent = 'მომხმარებლის სტატუსი განახლდა.';
  } catch (error) {
    console.error('Unable to update user status.', error);
    usersMessage.textContent = error.message || 'მომხმარებლის სტატუსის განახლება ვერ მოხერხდა.';
    button.disabled = false;
  }
});

commissionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const rate = Number(new FormData(commissionForm).get('commissionRate'));
  const message = document.getElementById('commission-message');
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    message.textContent = 'საკომისიო უნდა იყოს 0-დან 100%-მდე.';
    return;
  }
  try {
    await adminApi.saveCommissionRate(rate);
    message.textContent = 'საკომისიო შენახულია.';
  } catch (error) {
    console.error('Unable to save commission settings.', error);
    message.textContent = error.message || 'საკომისიოს შენახვა ვერ მოხერხდა.';
  }
});

pinForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = pinForm.querySelector('button[type="submit"]');
  const submittedPin = String(new FormData(pinForm).get('pin') || '');
  if (!submittedPin) {
    pinMessage.textContent = 'შეიყვანე ადმინისტრატორის PIN.';
    return;
  }
  if (!['http:', 'https:'].includes(location.protocol)) {
    pinMessage.textContent = 'PIN-ის სერვერული შემოწმება file:// რეჟიმში არ მუშაობს. ლოკალური ტესტისთვის გაუშვი npm run dev.';
    return;
  }

  button.disabled = true;
  pinMessage.textContent = 'PIN მოწმდება…';
  try {
    const result = await adminApi.login(submittedPin);
    pinForm.reset();
    pinMessage.textContent = '';
    window.DropZoneAdminMode = result.mode || 'production';
    acceptAdminPinSession(result.expiresAt);
    if (result.mode === 'test') {
      connectionLabel.textContent = 'ლოკალური სატესტო რეჟიმი · მონაცემები დროებითია';
    }
  } catch (error) {
    console.error('Admin PIN verification failed.', error);
    pinMessage.textContent = error.message || 'PIN-ის შემოწმება ვერ მოხერხდა.';
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  adminPinVerified = false;
  adminPinExpiresAt = 0;
  clearTimeout(adminPinExpiryTimer);
  adminPinExpiryTimer = null;
  stopAdminDataSubscriptions();
  pinCard.hidden = false;
  dashboardContent.hidden = true;
  dashboardContent.dataset.authenticated = 'false';
  logoutButton.hidden = true;
  document.dispatchEvent(new Event('dropzone-admin-logout'));
  try {
    await adminApi.logout();
    pinMessage.textContent = 'სესიიდან გამოხვედი.';
  } catch (error) {
    console.error('Admin PIN sign-out failed.', error);
    pinMessage.textContent = error.message || 'სესიიდან გამოსვლა ვერ მოხერხდა.';
  }
});

document.querySelectorAll('[data-admin-tab]').forEach(button => {
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-admin-tab]')];
    const index = tabs.indexOf(button);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    next.click();
  });
});

function startAdminDashboard() {
  if (!adminPinVerified || !adminApi) return;
  stopAdminDataSubscriptions();
  remoteProducts = [];
  remotePayments = [];
  remoteUsers = [];
  dashboardContent.hidden = false;
  dashboardContent.dataset.authenticated = 'true';
  logoutButton.hidden = false;
  connectionLabel.textContent = 'PIN სესია აქტიურია · მონაცემები იტვირთება…';
  document.dispatchEvent(new Event('dropzone-admin-ready'));

  adminProductsUnsubscribe = adminApi.subscribeAdminProducts(items => {
    remoteProducts = items;
    renderProducts();
    showAuthenticatedDashboard();
  }, handleAdminApiError);
  adminPaymentsUnsubscribe = adminApi.subscribeAdminPayments(items => {
    remotePayments = items;
    renderPayments();
  }, handleAdminApiError);
  adminSettingsUnsubscribe = adminApi.subscribeSettings(settings => {
    if (typeof settings.commissionRate === 'number') {
      commissionForm.elements.commissionRate.value = settings.commissionRate.toFixed(2);
    }
  }, handleAdminApiError);

  usersMessage.textContent = 'მომხმარებლები იტვირთება…';
  adminUsersUnsubscribe = adminApi.subscribeAdminUsers(items => {
    remoteUsers = items;
    renderUsers();
    usersMessage.textContent = items.length ? `${items.length} მომხმარებელი` : 'მომხმარებელი ჯერ არ არის.';
  }, error => {
    handleAdminApiError(error);
    usersMessage.textContent = error.message || 'მომხმარებლების სია ვერ ჩაიტვირთა.';
  });
}

async function restoreAdminPinSession() {
  if (!['http:', 'https:'].includes(location.protocol)) {
    connectionLabel.textContent = 'ლოკალური ტესტისთვის გაუშვი npm run dev';
    pinMessage.textContent = 'PIN სერვერის გარეშე ვერ მოწმდება. ლოკალური ტესტისთვის გაუშვი npm run dev.';
    return;
  }
  try {
    const result = await adminApi.getSession();
    if (!result.authenticated) {
      pinMessage.textContent = 'შესასვლელად შეიყვანე PIN.';
      return;
    }
    window.DropZoneAdminMode = result.mode || 'production';
    pinCard.hidden = true;
    acceptAdminPinSession(result.expiresAt);
    if (result.mode === 'test') {
      connectionLabel.textContent = 'ლოკალური სატესტო რეჟიმი · მონაცემები დროებითია';
    }
  } catch (error) {
    console.error('Unable to restore admin PIN session.', error);
    connectionLabel.textContent = error.message || 'PIN სესიის შემოწმება ვერ მოხერხდა.';
    pinMessage.textContent = error.message || 'PIN სესიის შემოწმება ვერ მოხერხდა.';
  }
}

pinCard.hidden = false;
dashboardContent.hidden = true;
logoutButton.hidden = true;
restoreAdminPinSession();

const { createHash, createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const COOKIE_NAME = 'dz_admin_pin';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PIN_ATTEMPTS = 5;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ADMIN_COLLECTIONS = [
  'transactions', 'payouts', 'vendors', 'disputes', 'categories', 'tags',
  'promoCodes', 'orders', 'sponsors', 'ads', 'reports', 'auditLogs'
];
const DELETABLE_COLLECTIONS = ['categories', 'tags', 'promoCodes', 'sponsors', 'ads'];
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

class AdminApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLocalTestMode() {
  const deployment = process.env.VERCEL_ENV;
  return process.env.DROPZONE_ADMIN_MODE === 'test'
    && process.env.NODE_ENV !== 'production'
    && deployment !== 'production'
    && deployment !== 'preview';
}

function getPinConfig() {
  const pin = process.env.ADMIN_PIN;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  if (!pin || pin.length > 128 || !sessionSecret || sessionSecret.length < 32) {
    throw new AdminApiError(503, 'admin_pin_not_configured',
      'ADMIN_PIN და მინიმუმ 32 სიმბოლოსგან შემდგარი ADMIN_SESSION_SECRET გარემოს ცვლადებია საჭირო.');
  }
  return { pin, sessionSecret };
}

function getFirebaseServices() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new AdminApiError(503, 'firebase_admin_not_configured',
      'ადმინისტრაციული მონაცემებისთვის Vercel-ში დააყენე FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL და FIREBASE_PRIVATE_KEY.');
  }
  const options = {
    credential: cert({ projectId, clientEmail, privateKey })
  };
  if (process.env.FIREBASE_STORAGE_BUCKET) options.storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const app = getApps()[0] || initializeApp(options);
  return {
    db: getFirestore(app),
    bucket: process.env.FIREBASE_STORAGE_BUCKET
      ? getStorage(app).bucket(process.env.FIREBASE_STORAGE_BUCKET)
      : null
  };
}

function hmac(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const cookie = cookies.map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : '';
}

function readSession(req, secret) {
  const [expiresAt, nonce, signature, ...extra] = readCookie(req).split('.');
  if (extra.length || !/^\d+$/.test(expiresAt || '') || !nonce || Number(expiresAt) <= Date.now()) return 0;
  const payload = `${expiresAt}.${nonce}`;
  return safeEqual(signature || '', hmac(payload, secret)) ? Number(expiresAt) : 0;
}

function setSessionCookie(res, value, maxAge) {
  const secure = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function hasTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const requestOrigin = new URL(origin);
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    return ['http:', 'https:'].includes(requestOrigin.protocol)
      && requestOrigin.host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function requestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function pinAttemptDocumentId(ip, secret) {
  return hmac(createHash('sha256').update(ip).digest('hex'), secret);
}

function memoryAttempts() {
  if (!globalThis.__dropzoneAdminPinAttempts) globalThis.__dropzoneAdminPinAttempts = new Map();
  return globalThis.__dropzoneAdminPinAttempts;
}

async function pinAttemptsBlocked(req, secret, testMode) {
  const id = pinAttemptDocumentId(requestIp(req), secret);
  if (testMode) {
    const attempt = memoryAttempts().get(id);
    if (!attempt || Date.now() - attempt.startedAt >= ATTEMPT_WINDOW_MS) return false;
    return attempt.count >= MAX_PIN_ATTEMPTS;
  }
  const { db } = getFirebaseServices();
  const snapshot = await db.collection('adminPinAttempts').doc(id).get();
  if (!snapshot.exists) return false;
  const attempt = snapshot.data();
  if (Date.now() - Number(attempt.startedAt || 0) >= ATTEMPT_WINDOW_MS) return false;
  return Number(attempt.count || 0) >= MAX_PIN_ATTEMPTS;
}

async function recordFailedPinAttempt(req, secret, testMode) {
  const id = pinAttemptDocumentId(requestIp(req), secret);
  if (testMode) {
    const attempts = memoryAttempts();
    const current = attempts.get(id);
    const expired = !current || Date.now() - current.startedAt >= ATTEMPT_WINDOW_MS;
    if (!expired && current.count >= MAX_PIN_ATTEMPTS) return true;
    if (expired) {
      attempts.set(id, { startedAt: Date.now(), count: 1 });
    } else {
      current.count += 1;
    }
    return false;
  }
  const { db } = getFirebaseServices();
  const ref = db.collection('adminPinAttempts').doc(id);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : {};
    const expired = Date.now() - Number(current.startedAt || 0) >= ATTEMPT_WINDOW_MS;
    if (!expired && Number(current.count || 0) >= MAX_PIN_ATTEMPTS) return true;
    transaction.set(ref, {
      startedAt: expired || !snapshot.exists ? Date.now() : current.startedAt,
      count: expired || !snapshot.exists ? 1 : Number(current.count || 0) + 1
    });
    return false;
  });
}

async function clearPinAttempts(req, secret, testMode) {
  const id = pinAttemptDocumentId(requestIp(req), secret);
  if (testMode) {
    memoryAttempts().delete(id);
    return;
  }
  const { db } = getFirebaseServices();
  await db.collection('adminPinAttempts').doc(id).delete();
}

function getTestStore() {
  if (!globalThis.__dropzoneAdminTestStore) {
    const now = new Date().toISOString();
    globalThis.__dropzoneAdminTestStore = {
      products: [{
        id: 'test-product-pending',
        name: '[TEST] კერამიკული ლარნაკი',
        description: 'ლოკალური სატესტო მონაცემი — production Firestore არ იცვლება.',
        seller: 'Test seller',
        sellerId: 'test-seller',
        price: 25,
        approvalStatus: 'Pending',
        createdAt: now
      }],
      paymentRequests: [],
      users: [{
        id: 'test-seller',
        name: '[TEST] გამყიდველი',
        email: 'seller@example.test',
        role: 'business',
        createdAt: now,
        profileCollection: 'users'
      }],
      userProfiles: [],
      settings: { commissionRate: 12 },
      siteConfig: {
        partnerName: 'უცხო ენების უმაღლესი სკოლა ნინო',
        tickerMessage: 'DropZone მხარს უჭერს უცხო ენების უმაღლეს სკოლა ნინოს — ჩვენს მთავარ პარტნიორს.'
      }
    };
    ADMIN_COLLECTIONS.forEach(name => {
      if (!globalThis.__dropzoneAdminTestStore[name]) globalThis.__dropzoneAdminTestStore[name] = [];
    });
  }
  return globalThis.__dropzoneAdminTestStore;
}

function apiError(status, code, message) {
  return new AdminApiError(status, code, message);
}

function requireRecordId(value) {
  const id = String(value || '');
  if (!id || id.length > 160 || id.includes('/')) throw apiError(400, 'invalid_record_id', 'ჩანაწერის ID არასწორია.');
  return id;
}

function requireCollection(value, allowed = ADMIN_COLLECTIONS) {
  const name = String(value || '');
  if (!allowed.includes(name)) throw apiError(400, 'invalid_collection', 'ადმინისტრაციული კოლექცია არასწორია.');
  return name;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw apiError(400, 'invalid_data', `${label} არასწორია.`);
  }
  return value;
}

function serialize(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanRecord(record) {
  const clean = { ...requireObject(record, 'ჩანაწერის მონაცემები') };
  delete clean.id;
  delete clean.createdAt;
  delete clean.updatedAt;
  return clean;
}

async function getAdminSnapshot(testMode) {
  if (testMode) {
    const store = getTestStore();
    return clone({
      products: store.products,
      paymentRequests: store.paymentRequests,
      users: store.users,
      userProfiles: store.userProfiles,
      settings: store.settings,
      siteConfig: store.siteConfig,
      ...Object.fromEntries(ADMIN_COLLECTIONS.map(name => [name, store[name]]))
    });
  }

  const { db } = getFirebaseServices();
  const names = ['products', 'paymentRequests', 'users', 'userProfiles', ...ADMIN_COLLECTIONS];
  const [collectionResults, settingsSnapshot, siteConfigSnapshot] = await Promise.all([
    Promise.all(names.map(async name => {
      const snapshot = await db.collection(name).limit(500).get();
      return [name, snapshot.docs.map(doc => serialize({ ...doc.data(), id: doc.id }))];
    })),
    db.collection('settings').doc('platform').get(),
    db.collection('siteConfig').doc('public').get()
  ]);
  return {
    ...Object.fromEntries(collectionResults),
    settings: settingsSnapshot.exists ? serialize(settingsSnapshot.data()) : {},
    siteConfig: siteConfigSnapshot.exists ? serialize(siteConfigSnapshot.data()) : {}
  };
}

async function writeAudit(action, collection, recordId, details, testMode) {
  const record = {
    action,
    collection,
    recordId: String(recordId || ''),
    details: details || {},
    actor: 'PIN administrator',
    createdAt: new Date().toISOString()
  };
  if (testMode) {
    const id = randomUUID();
    getTestStore().auditLogs.unshift({ ...record, id });
    return id;
  }
  const { db } = getFirebaseServices();
  const ref = await db.collection('auditLogs').add({
    ...record,
    createdAt: FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function createAdminRecord(collection, data, testMode) {
  const name = requireCollection(collection, ADMIN_COLLECTIONS.filter(item => item !== 'auditLogs'));
  const record = cleanRecord(data);
  if (testMode) {
    const id = randomUUID();
    const created = { ...record, id, createdAt: new Date().toISOString() };
    getTestStore()[name].unshift(created);
    await writeAudit('create', name, id, { type: record.type || record.status || '' }, true);
    return { id };
  }
  const { db } = getFirebaseServices();
  const ref = db.collection(name).doc();
  await ref.set({ ...record, createdAt: FieldValue.serverTimestamp() });
  await writeAudit('create', name, ref.id, { type: record.type || record.status || '' }, false);
  return { id: ref.id };
}

async function updateAdminRecord(collection, idValue, updatesValue, testMode) {
  const name = requireCollection(collection, [...ADMIN_COLLECTIONS, 'paymentRequests'].filter(item => item !== 'auditLogs'));
  const id = requireRecordId(idValue);
  const updates = cleanRecord(updatesValue);
  if (!Object.keys(updates).length) throw apiError(400, 'empty_update', 'ცვლილებები არ არის მითითებული.');
  if (testMode) {
    const records = getTestStore()[name];
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'record_not_found', 'ჩანაწერი ვერ მოიძებნა.');
    records[index] = { ...records[index], ...updates, updatedAt: new Date().toISOString() };
    await writeAudit('update', name, id, { fields: Object.keys(updates) }, true);
    return { updated: true };
  }
  const { db } = getFirebaseServices();
  await db.collection(name).doc(id).update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  await writeAudit('update', name, id, { fields: Object.keys(updates) }, false);
  return { updated: true };
}

async function deleteAdminRecord(collection, idValue, testMode) {
  const name = requireCollection(collection, DELETABLE_COLLECTIONS);
  const id = requireRecordId(idValue);
  if (testMode) {
    const records = getTestStore()[name];
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'record_not_found', 'ჩანაწერი ვერ მოიძებნა.');
    records.splice(index, 1);
    await writeAudit('delete', name, id, {}, true);
    return { deleted: true };
  }
  const { db, bucket } = getFirebaseServices();
  const ref = db.collection(name).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw apiError(404, 'record_not_found', 'ჩანაწერი ვერ მოიძებნა.');
  if (snapshot.data().storagePath) {
    if (!bucket) throw apiError(503, 'storage_not_configured', 'სურათების წასაშლელად FIREBASE_STORAGE_BUCKET უნდა იყოს კონფიგურირებული.');
    await bucket.file(snapshot.data().storagePath).delete({ ignoreNotFound: true });
  }
  await ref.delete();
  await writeAudit('delete', name, id, {}, false);
  return { deleted: true };
}

async function updateProduct(idValue, updatesValue, testMode) {
  const id = requireRecordId(idValue);
  const updates = cleanRecord(updatesValue);
  if (testMode) {
    const records = getTestStore().products;
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'product_not_found', 'პროდუქტი ვერ მოიძებნა.');
    records[index] = { ...records[index], ...updates, updatedAt: new Date().toISOString() };
  } else {
    const { db } = getFirebaseServices();
    await db.collection('products').doc(id).update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  }
  await writeAudit('update-product', 'products', id, { fields: Object.keys(updates) }, testMode);
  return { updated: true };
}

async function deleteProduct(idValue, testMode) {
  const id = requireRecordId(idValue);
  if (testMode) {
    const store = getTestStore();
    const index = store.products.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'product_not_found', 'პროდუქტი ვერ მოიძებნა.');
    store.products.splice(index, 1);
  } else {
    const { db, bucket } = getFirebaseServices();
    const ref = db.collection('products').doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw apiError(404, 'product_not_found', 'პროდუქტი ვერ მოიძებნა.');
    if (snapshot.data().storagePath) {
      if (!bucket) throw apiError(503, 'storage_not_configured', 'სურათების წასაშლელად FIREBASE_STORAGE_BUCKET უნდა იყოს კონფიგურირებული.');
      await bucket.file(snapshot.data().storagePath).delete({ ignoreNotFound: true });
    }
    await ref.delete();
  }
  await writeAudit('delete-product', 'products', id, {}, testMode);
  return { deleted: true };
}

async function updateAdminUser(idValue, profileCollection, updatesValue, testMode) {
  const id = requireRecordId(idValue);
  const collection = String(profileCollection) === 'userProfiles' ? 'userProfiles'
    : String(profileCollection) === 'users' ? 'users' : '';
  const updates = cleanRecord(updatesValue);
  const allowedFields = ['verified', 'vip', 'banned', 'bonusTier', 'freeBoosts', 'commissionDiscount'];
  const fields = Object.keys(updates);
  const validBonus = fields.length === 3
    && ['none', 'bronze', 'silver', 'gold'].includes(updates.bonusTier)
    && Number.isInteger(updates.freeBoosts) && updates.freeBoosts >= 0 && updates.freeBoosts <= 100
    && Number.isFinite(updates.commissionDiscount) && updates.commissionDiscount >= 0 && updates.commissionDiscount <= 100;
  const validStatus = fields.length === 1 && allowedFields.includes(fields[0]) && typeof updates[fields[0]] === 'boolean';
  if (!collection || (!validBonus && !validStatus)) throw apiError(400, 'invalid_user_update', 'მომხმარებლის განახლების მონაცემები არასწორია.');
  if (testMode) {
    const records = getTestStore()[collection];
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'user_not_found', 'მომხმარებელი ვერ მოიძებნა.');
    records[index] = { ...records[index], ...updates, updatedAt: new Date().toISOString() };
  } else {
    const { db } = getFirebaseServices();
    await db.collection(collection).doc(id).update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  }
  await writeAudit(validBonus ? 'update-seller-bonus' : 'update-user-status', collection, id, updates, testMode);
  return { updated: true };
}

async function updatePayment(idValue, status, testMode) {
  if (!['approved', 'rejected'].includes(status)) throw apiError(400, 'invalid_payment_status', 'გადახდის სტატუსი არასწორია.');
  return updateAdminRecord('paymentRequests', idValue, { status, reviewedAt: new Date().toISOString() }, testMode);
}

async function saveCommissionRate(value, testMode) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw apiError(400, 'invalid_commission_rate', 'საკომისიო უნდა იყოს 0-დან 100%-მდე.');
  if (testMode) getTestStore().settings = { ...getTestStore().settings, commissionRate: rate };
  else {
    const { db } = getFirebaseServices();
    await db.collection('settings').doc('platform').set({ commissionRate: rate, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await writeAudit('update-commission-rate', 'settings', 'platform', { commissionRate: rate }, testMode);
  return { saved: true };
}

async function updateOrderStatus(idValue, status, testMode) {
  const id = requireRecordId(idValue);
  if (!['shipped', 'delivered'].includes(status)) throw apiError(400, 'invalid_order_status', 'შეკვეთის სტატუსი არასწორია.');
  const now = new Date();
  const updates = { status, updatedAt: now.toISOString() };
  if (status === 'shipped') updates.shippedAt = now.toISOString();
  if (status === 'delivered') {
    updates.deliveredAt = now.toISOString();
    updates.releaseAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
    updates.escrowStatus = 'held';
  }
  if (testMode) {
    const records = getTestStore().orders;
    const index = records.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'order_not_found', 'შეკვეთა ვერ მოიძებნა.');
    const current = records[index].status;
    if (!((current === 'pending' && status === 'shipped') || (current === 'shipped' && status === 'delivered'))) {
      throw apiError(409, 'invalid_order_transition', 'შეკვეთის სტატუსის ეს გადასვლა დაუშვებელია.');
    }
    records[index] = { ...records[index], ...updates };
  } else {
    const { db } = getFirebaseServices();
    const ref = db.collection('orders').doc(id);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw apiError(404, 'order_not_found', 'შეკვეთა ვერ მოიძებნა.');
      const current = snapshot.data().status;
      if (!((current === 'pending' && status === 'shipped') || (current === 'shipped' && status === 'delivered'))) {
        throw apiError(409, 'invalid_order_transition', 'შეკვეთის სტატუსის ეს გადასვლა დაუშვებელია.');
      }
      const serverUpdates = { status, updatedAt: FieldValue.serverTimestamp() };
      if (status === 'shipped') serverUpdates.shippedAt = FieldValue.serverTimestamp();
      if (status === 'delivered') {
        serverUpdates.deliveredAt = FieldValue.serverTimestamp();
        serverUpdates.releaseAt = Timestamp.fromDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000));
        serverUpdates.escrowStatus = 'held';
      }
      transaction.update(ref, serverUpdates);
    });
  }
  await writeAudit('update-order-status', 'orders', id, { status }, testMode);
  return { updated: true };
}

async function approveVendor(idValue, updatesValue, testMode) {
  const id = requireRecordId(idValue);
  const updates = cleanRecord(updatesValue);
  if (testMode) {
    const store = getTestStore();
    const index = store.vendors.findIndex(item => item.id === id);
    if (index < 0) throw apiError(404, 'vendor_not_found', 'გამყიდველის ჩანაწერი ვერ მოიძებნა.');
    store.vendors[index] = { ...store.vendors[index], ...updates, verified: true, verifiedAt: new Date().toISOString() };
    await writeAudit('verify-vendor', 'vendors', id, {}, true);
    return { updated: true };
  }
  const { db } = getFirebaseServices();
  const vendorRef = db.collection('vendors').doc(id);
  const vendorProducts = await db.collection('products').where('sellerId', '==', String(updates.email || '').toLowerCase()).get();
  const batch = db.batch();
  batch.set(vendorRef, { ...updates, verified: true, verifiedAt: FieldValue.serverTimestamp() }, { merge: true });
  vendorProducts.docs.forEach(doc => batch.update(doc.ref, { verified: true }));
  await batch.commit();
  await writeAudit('verify-vendor', 'vendors', id, { affectedProducts: vendorProducts.size }, false);
  return { updated: true };
}

async function setVendorBlocked(idValue, blocked, testMode) {
  const id = requireRecordId(idValue);
  if (typeof blocked !== 'boolean') throw apiError(400, 'invalid_vendor_status', 'გამყიდველის სტატუსი არასწორია.');
  if (testMode) {
    const store = getTestStore();
    const vendor = store.vendors.find(item => item.id === id);
    if (!vendor) throw apiError(404, 'vendor_not_found', 'გამყიდველის ჩანაწერი ვერ მოიძებნა.');
    vendor.blocked = blocked;
    await writeAudit(blocked ? 'block-vendor' : 'unblock-vendor', 'vendors', id, {}, true);
    return { updated: true };
  }
  const { db } = getFirebaseServices();
  const vendorRef = db.collection('vendors').doc(id);
  const vendor = await vendorRef.get();
  if (!vendor.exists) throw apiError(404, 'vendor_not_found', 'გამყიდველის ჩანაწერი ვერ მოიძებნა.');
  const products = await db.collection('products').where('sellerId', '==', vendor.data().email).get();
  const batch = db.batch();
  products.docs.forEach(doc => {
    const product = doc.data();
    batch.update(doc.ref, blocked
      ? { approvalStatus: 'Hidden', preBlockApprovalStatus: product.approvalStatus || 'Pending' }
      : { approvalStatus: product.preBlockApprovalStatus || 'Pending', preBlockApprovalStatus: FieldValue.delete() });
  });
  batch.update(vendorRef, { blocked, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  await writeAudit(blocked ? 'block-vendor' : 'unblock-vendor', 'vendors', id, { affectedProducts: products.size }, false);
  return { updated: true };
}

async function recordDisputeRefund(disputeIdValue, transactionIdValue, testMode) {
  const disputeId = requireRecordId(disputeIdValue);
  const transactionId = requireRecordId(transactionIdValue);
  if (testMode) {
    const store = getTestStore();
    const dispute = store.disputes.find(item => item.id === disputeId && item.status === 'open');
    const source = store.transactions.find(item => item.id === transactionId);
    if (!dispute || !source || source.type !== 'sale' || Number(source.gmv) <= 0
      || ['refunded', 'disputed'].includes(source.payoutStatus)) {
      throw apiError(409, 'invalid_refund', 'ღია დავა ან დასაბრუნებელი გაყიდვის ტრანზაქცია ვერ მოიძებნა.');
    }
    const now = new Date().toISOString();
    store.transactions.unshift({
      id: randomUUID(), type: 'refund', buyer: source.buyer || '', vendorId: source.vendorId || '',
      description: `Refund: ${source.description || ''} (${transactionId})`, method: 'manual / external provider',
      gmv: -Math.abs(Number(source.gmv)), netRevenue: -Math.abs(Number(source.netRevenue)),
      artistPayout: -Math.abs(Number(source.artistPayout)), payoutStatus: 'not-applicable',
      sourceTransactionId: transactionId, transactionDate: now, createdAt: now
    });
    dispute.status = 'refunded-recorded';
    dispute.resolvedAt = now;
    source.payoutStatus = 'refunded';
  } else {
    const { db } = getFirebaseServices();
    const disputeRef = db.collection('disputes').doc(disputeId);
    const sourceRef = db.collection('transactions').doc(transactionId);
    const refundRef = db.collection('transactions').doc();
    const auditRef = db.collection('auditLogs').doc();
    await db.runTransaction(async transaction => {
      const [disputeSnapshot, sourceSnapshot] = await Promise.all([
        transaction.get(disputeRef), transaction.get(sourceRef)
      ]);
      if (!disputeSnapshot.exists || disputeSnapshot.data().status !== 'open') {
        throw apiError(409, 'invalid_dispute', 'ღია დავა ვერ მოიძებნა ან უკვე დამუშავებულია.');
      }
      if (!sourceSnapshot.exists || sourceSnapshot.data().type !== 'sale'
        || Number(sourceSnapshot.data().gmv) <= 0
        || ['refunded', 'disputed'].includes(sourceSnapshot.data().payoutStatus)) {
        throw apiError(409, 'invalid_refund', 'ტრანზაქცია არასწორია ან თანხა უკვე დავაში/დაბრუნებაშია.');
      }
      const source = sourceSnapshot.data();
      const now = FieldValue.serverTimestamp();
      transaction.set(refundRef, {
        type: 'refund', buyer: source.buyer || '', vendorId: source.vendorId || '',
        description: `Refund: ${source.description || ''} (${transactionId})`,
        method: 'manual / external provider', gmv: -Math.abs(Number(source.gmv)),
        netRevenue: -Math.abs(Number(source.netRevenue)), artistPayout: -Math.abs(Number(source.artistPayout)),
        payoutStatus: 'not-applicable', sourceTransactionId: transactionId,
        transactionDate: now, createdAt: now
      });
      transaction.update(disputeRef, { status: 'refunded-recorded', resolvedAt: now, updatedAt: now });
      transaction.update(sourceRef, { payoutStatus: 'refunded', updatedAt: now });
      transaction.set(auditRef, {
        action: 'record-refund', collection: 'disputes', recordId: disputeId,
        details: { sourceTransactionId: transactionId, refundTransactionId: refundRef.id },
        actor: 'PIN administrator', createdAt: now
      });
    });
  }
  if (testMode) await writeAudit('record-refund', 'disputes', disputeId, { sourceTransactionId: transactionId }, true);
  return { updated: true };
}

async function uploadAdminMedia(folder, payload, testMode) {
  const name = String(folder || '');
  if (!['sponsors', 'ads'].includes(name)) throw apiError(400, 'invalid_media_folder', 'ატვირთვის საქაღალდე არასწორია.');
  const mimeType = String(payload?.mimeType || '').toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) throw apiError(400, 'invalid_image_type', 'აირჩიე PNG, JPEG, WebP ან GIF სურათი.');
  const base64 = String(payload?.base64 || '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw apiError(413, 'image_too_large', 'სურათის მაქსიმალური ზომაა 2 მბ.');
  }
  if (buffer.toString('base64') !== base64) throw apiError(400, 'invalid_image_data', 'სურათის მონაცემები არასწორია.');
  const safeName = String(payload.fileName || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const path = `${name}/${Date.now()}-${randomUUID()}-${safeName}`;
  if (testMode) {
    const store = getTestStore();
    if (!store.__media) store.__media = new Map();
    const url = `data:${mimeType};base64,${buffer.toString('base64')}`;
    store.__media.set(path, url);
    return { url, path };
  }
  const { bucket } = getFirebaseServices();
  if (!bucket) throw apiError(503, 'storage_not_configured', 'სურათების ატვირთვისთვის FIREBASE_STORAGE_BUCKET უნდა იყოს კონფიგურირებული.');
  const token = randomUUID();
  await bucket.file(path).save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  return { url, path };
}

async function saveAdminSiteConfig(updatesValue, testMode) {
  const updates = requireObject(updatesValue, 'საიტის პარამეტრები');
  const allowed = ['tickerMessage', 'partnerName', 'partnerDescription', 'partnerWebsiteUrl', 'partnerLogoUrl'];
  const fields = Object.keys(updates);
  if (!fields.length || fields.some(field => !allowed.includes(field))
    || fields.some(field => typeof updates[field] !== 'string' || updates[field].length > 1200)) {
    throw apiError(400, 'invalid_site_config', 'საიტის პარამეტრები არასწორია.');
  }
  if (testMode) getTestStore().siteConfig = { ...getTestStore().siteConfig, ...updates };
  else {
    const { db } = getFirebaseServices();
    await db.collection('siteConfig').doc('public').set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  await writeAudit('update-site-config', 'siteConfig', 'public', { fields }, testMode);
  return { saved: true };
}

async function executeAction(action, body, testMode) {
  switch (action) {
    case 'snapshot':
      return getAdminSnapshot(testMode);
    case 'create-record':
      return createAdminRecord(body.collection, body.data, testMode);
    case 'update-record':
      return updateAdminRecord(body.collection, body.id, body.updates, testMode);
    case 'delete-record':
      return deleteAdminRecord(body.collection, body.id, testMode);
    case 'update-product':
      return updateProduct(body.id, body.updates, testMode);
    case 'delete-product':
      return deleteProduct(body.id, testMode);
    case 'update-user':
      return updateAdminUser(body.id, body.profileCollection, body.updates, testMode);
    case 'update-payment':
      return updatePayment(body.id, body.status, testMode);
    case 'save-commission':
      return saveCommissionRate(body.rate, testMode);
    case 'update-order':
      return updateOrderStatus(body.id, body.status, testMode);
    case 'approve-vendor':
      return approveVendor(body.id, body.updates, testMode);
    case 'set-vendor-blocked':
      return setVendorBlocked(body.id, body.blocked, testMode);
    case 'record-dispute-refund':
      return recordDisputeRefund(body.disputeId, body.transactionId, testMode);
    case 'upload-media':
      return uploadAdminMedia(body.folder, body.file, testMode);
    case 'save-site-config':
      return saveAdminSiteConfig(body.updates, testMode);
    default:
      throw apiError(400, 'unknown_admin_action', 'ადმინისტრაციული მოქმედება უცნობია.');
  }
}

function parseBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      throw apiError(400, 'invalid_json', 'მოთხოვნის JSON არასწორია.');
    }
  }
  return body && typeof body === 'object' ? body : {};
}

module.exports = async function adminApi(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const testMode = isLocalTestMode();

  try {
    if (req.method === 'GET') {
      const { sessionSecret } = getPinConfig();
      const expiresAt = readSession(req, sessionSecret);
      if (!expiresAt) return res.status(401).json({ authenticated: false, error: 'session_required' });
      return res.status(200).json({ authenticated: true, expiresAt, mode: testMode ? 'test' : 'production' });
    }
    if (req.method === 'DELETE') {
      if (!hasTrustedOrigin(req)) throw apiError(403, 'invalid_origin', 'გამოსვლის მოთხოვნა უნდა გაიგზავნოს იმავე საიტის დომენიდან.');
      setSessionCookie(res, '', 0);
      return res.status(200).json({ authenticated: false });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE');
      throw apiError(405, 'method_not_allowed', 'მოთხოვნის მეთოდი დაუშვებელია.');
    }
    if (!hasTrustedOrigin(req)) throw apiError(403, 'invalid_origin', 'მოთხოვნა უნდა გაიგზავნოს იმავე საიტის დომენიდან.');

    const body = parseBody(req.body);
    const { pin, sessionSecret } = getPinConfig();
    if (body.action === 'login') {
      if (!testMode) getFirebaseServices();
      if (await pinAttemptsBlocked(req, sessionSecret, testMode)) {
        throw apiError(429, 'pin_rate_limited', 'PIN-ის მცდელობების ლიმიტი ამოიწურა. სცადე 15 წუთის შემდეგ.');
      }
      const submittedPin = typeof body.pin === 'string' ? body.pin : '';
      if (submittedPin.length > 128 || !safeEqual(submittedPin, pin)) {
        const blocked = await recordFailedPinAttempt(req, sessionSecret, testMode);
        if (blocked) throw apiError(429, 'pin_rate_limited', 'PIN-ის მცდელობების ლიმიტი ამოიწურა. სცადე 15 წუთის შემდეგ.');
        throw apiError(401, 'invalid_pin', 'PIN არასწორია.');
      }
      await clearPinAttempts(req, sessionSecret, testMode);
      const expiresAt = Date.now() + SESSION_DURATION_MS;
      const payload = `${expiresAt}.${randomUUID()}`;
      setSessionCookie(res, `${payload}.${hmac(payload, sessionSecret)}`, SESSION_DURATION_MS / 1000);
      return res.status(200).json({ authenticated: true, expiresAt, mode: testMode ? 'test' : 'production' });
    }

    const expiresAt = readSession(req, sessionSecret);
    if (!expiresAt) throw apiError(401, 'session_expired', 'ადმინისტრატორის PIN სესია ვადაგასულია. შედი თავიდან.');
    if (Date.now() >= expiresAt) throw apiError(401, 'session_expired', 'ადმინისტრატორის PIN სესია ვადაგასულია. შედი თავიდან.');
    if (!testMode) getFirebaseServices();
    const result = await executeAction(String(body.action || ''), body, testMode);
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    const status = error instanceof AdminApiError ? error.status : 500;
    const code = error instanceof AdminApiError ? error.code : 'admin_api_failed';
    const message = error instanceof AdminApiError ? error.message : 'ადმინისტრაციული მოთხოვნა ვერ შესრულდა.';
    if (status >= 500) console.error('Admin API failed.', error);
    return res.status(status).json({ ok: false, error: code, message });
  }
};

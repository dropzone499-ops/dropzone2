(function initializeDropZoneFirebase() {
  const config = window.DROPZONE_FIREBASE_CONFIG;
  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];
  const configured = config && requiredKeys.every(key => typeof config[key] === 'string' && config[key].trim());
  if (!configured) {
    window.DropZoneFirebase = null;
    window.DropZoneFirebaseStatus = {
      ready: false,
      code: 'config-missing',
      message: 'Firebase Web App კონფიგურაციაში აკლია apiKey, authDomain, projectId, storageBucket ან appId.'
    };
    return;
  }
  if (!window.firebase?.auth || !window.firebase?.firestore || !window.firebase?.storage) {
    window.DropZoneFirebase = null;
    window.DropZoneFirebaseStatus = {
      ready: false,
      code: 'sdk-missing',
      message: 'Firebase SDK ვერ ჩაიტვირთა. შეამოწმე ქსელი და Firebase SDK-ის სკრიპტები.'
    };
    return;
  }

  let app;
  let db;
  let bucket;
  try {
    app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    db = app.firestore();
    bucket = app.storage();
  } catch (error) {
    console.error('Firebase initialization failed.', error);
    window.DropZoneFirebase = null;
    window.DropZoneFirebaseStatus = {
      ready: false,
      code: 'initialization-failed',
      message: `Firebase ინიციალიზაცია ვერ შესრულდა: ${error.message || 'კონფიგურაცია არასწორია.'}`
    };
    return;
  }
  const products = db.collection('products');
  const users = db.collection('users');
  const legacyUserProfiles = db.collection('userProfiles');
  const chats = db.collection('chats');
  const paymentRequests = db.collection('paymentRequests');
  const settings = db.collection('settings').doc('platform');
  const adminCollections = [
    'transactions', 'payouts', 'vendors', 'disputes', 'categories', 'tags',
    'promoCodes', 'orders', 'sponsors', 'ads', 'reports'
  ];
  async function requireAdmin() {
    const user = firebase.auth?.().currentUser;
    if (!user || (await user.getIdTokenResult()).claims.admin !== true) {
      throw new Error('ამ მოქმედებისთვის ადმინისტრატორის უფლებებია საჭირო.');
    }
    return user;
  }
  async function writeAudit(action, collection, recordId, details = {}) {
    const user = await requireAdmin();
    await db.collection('auditLogs').add({
      action,
      collection,
      recordId: String(recordId || ''),
      details,
      actor: user.email || user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  window.DropZoneFirebase = {
    isReady: true,
    subscribeSponsors(onChange, onError) {
      return db.collection('sponsors').where('active', '==', true).onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    subscribeAds(onChange, onError) {
      return db.collection('ads').where('active', '==', true).onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    subscribeSiteConfig(onChange, onError) {
      return db.collection('siteConfig').doc('public').onSnapshot(snapshot => {
        onChange(snapshot.exists ? snapshot.data() : {});
      }, onError);
    },
    async trackSponsorClick(id) {
      if (!id) throw new Error('სპონსორის ჩანაწერი ვერ მოიძებნა.');
      await db.collection('sponsors').doc(String(id)).update({
        clicks: firebase.firestore.FieldValue.increment(1)
      });
    },
    async trackAdClick(id) {
      if (!id) throw new Error('რეკლამა ვერ მოიძებნა.');
      await db.collection('ads').doc(String(id)).update({
        clicks: firebase.firestore.FieldValue.increment(1)
      });
    },
    async createReport(report) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('რეპორტის გასაგზავნად ანგარიშში შესვლაა საჭირო.');
      const type = String(report.type || '');
      const targetId = String(report.targetId || '').trim();
      const reason = String(report.reason || '').trim();
      if (!['product', 'user'].includes(type) || !targetId || !reason || reason.length > 1200) {
        throw new Error('რეპორტის მონაცემები არასწორია.');
      }
      const ref = db.collection('reports').doc();
      await ref.set({
        type,
        targetId: targetId.slice(0, 160),
        reason,
        reporterUid: user.uid,
        status: 'open',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    },
    async saveUserPreferences(preferences) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('შენახული ნივთების სინქრონიზაციისთვის ანგარიშში შესვლაა საჭირო.');
      const updates = {};
      if (Array.isArray(preferences.wishlist)) {
        updates.wishlist = [...new Set(preferences.wishlist.map(String).filter(Boolean))].slice(0, 500);
      }
      if (Array.isArray(preferences.cart)) {
        updates.cart = preferences.cart.slice(0, 100).map(item => ({
          id: String(item.id || '').slice(0, 160),
          quantity: Math.max(1, Math.min(20, Math.trunc(Number(item.quantity) || 1)))
        })).filter(item => item.id);
      }
      if (!Object.keys(updates).length) return;
      await users.doc(user.uid).set(updates, { merge: true });
    },
    async createReview(productId, rating, text) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('შეფასებისთვის ანგარიშში შესვლაა საჭირო.');
      const score = Number(rating);
      const message = String(text || '').trim();
      if (!productId || !Number.isInteger(score) || score < 1 || score > 5 || !message || message.length > 1200) {
        throw new Error('შეფასების მონაცემები არასწორია.');
      }
      const ref = db.collection('reviews').doc();
      await ref.set({
        productId: String(productId).slice(0, 160),
        userId: user.uid,
        rating: score,
        text: message,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return ref.id;
    },
    subscribeProductReviews(productId, onChange, onError) {
      if (!productId) throw new Error('ნამუშევრის მითითება სავალდებულოა.');
      return db.collection('reviews').where('productId', '==', String(productId)).limit(100).onSnapshot(snapshot => {
          onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).sort((left, right) => {
            const time = value => typeof value?.toDate === 'function' ? value.toDate().getTime() : new Date(value || 0).getTime();
            return time(right.createdAt) - time(left.createdAt);
          }));
        }, onError);
    },
    subscribeProducts(onChange, onError) {
      return products.where('approvalStatus', '==', 'Approved').onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    subscribeCatalog(onCategories, onTags, onError) {
      const categoriesUnsubscribe = db.collection('categories').onSnapshot(snapshot => {
        onCategories(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
      const tagsUnsubscribe = db.collection('tags').onSnapshot(snapshot => {
        onTags(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
      return () => {
        categoriesUnsubscribe();
        tagsUnsubscribe();
      };
    },
    subscribeAdminPayments(onChange, onError) {
      return paymentRequests.onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    subscribeAdminCollection(name, onChange, onError) {
      if (!adminCollections.includes(name) && name !== 'auditLogs') {
        throw new Error('ადმინისტრატორის კოლექცია არასწორია.');
      }
      return db.collection(name).orderBy('createdAt', 'desc').limit(500).onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    async createAdminRecord(name, data) {
      if (!adminCollections.includes(name)) throw new Error('ჩანაწერის კოლექცია არასწორია.');
      await requireAdmin();
      const ref = db.collection(name).doc();
      const record = { ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await ref.set(record);
      await writeAudit('create', name, ref.id, { type: data.type || data.status || '' });
      return ref.id;
    },
    async updateAdminRecord(name, id, updates) {
      if (!adminCollections.includes(name) || !id) throw new Error('ჩანაწერის მითითება არასწორია.');
      await requireAdmin();
      await db.collection(name).doc(String(id)).update({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await writeAudit('update', name, id, { fields: Object.keys(updates) });
    },
    async getPromoCode(code) {
      const snapshot = await db.collection('promoCodes').where('code', '==', String(code).trim().toUpperCase()).limit(1).get();
      const record = snapshot.docs[0];
      return record ? { ...record.data(), id: record.id } : null;
    },
    async deleteAdminRecord(name, id) {
      if (!['categories', 'tags', 'promoCodes', 'sponsors', 'ads'].includes(name) || !id) {
        throw new Error('ამ ჩანაწერის წაშლა დაუშვებელია.');
      }
      await requireAdmin();
      const ref = db.collection(name).doc(String(id));
      const snapshot = await ref.get();
      if (snapshot.exists && snapshot.data().storagePath) {
        await bucket.ref(snapshot.data().storagePath).delete();
      }
      await ref.delete();
      await writeAudit('delete', name, id);
    },
    async approveVendor(id, updates) {
      if (!id) throw new Error('გამყიდველის ჩანაწერი ვერ მოიძებნა.');
      await requireAdmin();
      const vendorRef = db.collection('vendors').doc(String(id));
      const vendorProducts = await products.where('sellerId', '==', String(updates.email || '').toLowerCase()).get();
      const batch = db.batch();
      batch.set(vendorRef, {
        ...updates,
        verified: true,
        verifiedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      vendorProducts.docs.forEach(doc => batch.update(doc.ref, { verified: true }));
      await batch.commit();
      await writeAudit('verify-vendor', 'vendors', id, { affectedProducts: vendorProducts.size });
    },
    async setVendorBlocked(id, blocked) {
      await requireAdmin();
      const vendor = await db.collection('vendors').doc(String(id)).get();
      if (!vendor.exists) throw new Error('გამყიდველის ჩანაწერი ვერ მოიძებნა.');
      const productsSnapshot = await products.where('sellerId', '==', vendor.data().email).get();
      const batch = db.batch();
      productsSnapshot.docs.forEach(doc => {
        const product = doc.data();
        if (blocked) {
          batch.update(doc.ref, {
            approvalStatus: 'Hidden',
            preBlockApprovalStatus: product.approvalStatus || 'Pending'
          });
        } else {
          batch.update(doc.ref, {
            approvalStatus: product.preBlockApprovalStatus || 'Pending',
            preBlockApprovalStatus: firebase.firestore.FieldValue.delete()
          });
        }
      });
      batch.update(vendor.ref, { blocked, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      await batch.commit();
      await writeAudit(blocked ? 'block-vendor' : 'unblock-vendor', 'vendors', id, {
        affectedProducts: productsSnapshot.size
      });
    },
    async recordDisputeRefund(disputeId, transactionId) {
      const user = await requireAdmin();
      const disputeRef = db.collection('disputes').doc(String(disputeId));
      const sourceRef = db.collection('transactions').doc(String(transactionId));
      const refundRef = db.collection('transactions').doc();
      const auditRef = db.collection('auditLogs').doc();
      await db.runTransaction(async transaction => {
        const disputeSnapshot = await transaction.get(disputeRef);
        const sourceSnapshot = await transaction.get(sourceRef);
        if (!disputeSnapshot.exists || disputeSnapshot.data().status !== 'open') {
          throw new Error('ღია დავა ვერ მოიძებნა ან უკვე დამუშავებულია.');
        }
        if (!sourceSnapshot.exists || sourceSnapshot.data().type !== 'sale'
          || Number(sourceSnapshot.data().gmv) <= 0
          || ['refunded', 'disputed'].includes(sourceSnapshot.data().payoutStatus)) {
          throw new Error('გასაყიდი ტრანზაქცია არასწორია ან თანხა უკვე დავაში/დაბრუნებაშია.');
        }
        const source = sourceSnapshot.data();
        const now = firebase.firestore.FieldValue.serverTimestamp();
        transaction.set(refundRef, {
          type: 'refund',
          buyer: source.buyer || '',
          vendorId: source.vendorId || '',
          description: `Refund: ${source.description || ''} (${sourceRef.id})`,
          method: 'manual / external provider',
          gmv: -Math.abs(Number(source.gmv)),
          netRevenue: -Math.abs(Number(source.netRevenue)),
          artistPayout: -Math.abs(Number(source.artistPayout)),
          payoutStatus: 'not-applicable',
          sourceTransactionId: sourceRef.id,
          transactionDate: now,
          createdAt: now
        });
        transaction.update(disputeRef, { status: 'refunded-recorded', resolvedAt: now, updatedAt: now });
        transaction.update(sourceRef, { payoutStatus: 'refunded', updatedAt: now });
        transaction.set(auditRef, {
          action: 'record-refund',
          collection: 'disputes',
          recordId: disputeRef.id,
          details: { sourceTransactionId: sourceRef.id, refundTransactionId: refundRef.id },
          actor: user.email || user.uid,
          createdAt: now
        });
      });
    },
    async logAdminAction(action, collection, recordId, details = {}) {
      await writeAudit(action, collection, recordId, details);
    },
    updateAdminPayment(id, status) {
      if (!['approved', 'rejected'].includes(status)) throw new Error('გადახდის სტატუსი არასწორია.');
      return requireAdmin().then(async () => {
        await paymentRequests.doc(String(id)).update({ status, reviewedAt: new Date().toISOString() });
        await writeAudit('review-payment', 'paymentRequests', id, { status });
      });
    },
    async signInAdmin(email, password) {
      if (!firebase.auth) throw new Error('Firebase Authentication არ არის ჩართული.');
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
      const token = await credential.user.getIdTokenResult(true);
      if (token.claims.admin !== true) {
        await firebase.auth().signOut();
        throw new Error('ამ ანგარიშს ადმინისტრატორის უფლებები არ აქვს.');
      }
    },
    getCurrentUser() {
      return firebase.auth?.().currentUser || null;
    },
    async refreshCurrentUser() {
      const user = firebase.auth?.().currentUser;
      if (!user) return false;
      await user.reload();
      return user.emailVerified;
    },
    async registerUser(email, password, profile) {
      if (!firebase.auth) throw new Error('Firebase Authentication არ არის ჩართული.');
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const credential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = credential.user;
      const record = {
        email: user.email || String(email).trim().toLowerCase(),
        name: String(profile.name || '').trim(),
        role: profile.role === 'business' ? 'business' : 'private',
        bio: String(profile.bio || '').trim(),
        address: String(profile.address || '').trim(),
        socials: profile.socials || {},
        verified: false,
        vip: false,
        banned: false,
        bonusTier: 'none',
        freeBoosts: 0,
        commissionDiscount: 0
      };
      await users.doc(user.uid).set({
        ...record,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await user.sendEmailVerification();
      return { ...record, uid: user.uid, balance: 0, banned: false, emailVerified: user.emailVerified };
    },
    async signInUser(email, password) {
      if (!firebase.auth) throw new Error('Firebase Authentication არ არის ჩართული.');
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const credential = await firebase.auth().signInWithEmailAndPassword(email, password);
      const user = credential.user;
      const userSnapshot = await users.doc(user.uid).get();
      const snapshot = userSnapshot.exists ? userSnapshot : await legacyUserProfiles.doc(user.uid).get();
      const profile = snapshot.exists ? snapshot.data() : {};
      return {
        ...profile,
        uid: user.uid,
        email: user.email || String(email).trim().toLowerCase(),
        name: profile.name || user.displayName || user.email || '',
        balance: Number(profile.balance || 0),
        banned: profile.banned === true
      };
    },
    async signOutUser() {
      if (!firebase.auth) return;
      await firebase.auth().signOut();
    },
    onUserAuthStateChanged(onChange, onError) {
      if (!firebase.auth) throw new Error('Firebase Authentication არ არის ჩართული.');
      return firebase.auth().onAuthStateChanged(onChange, onError);
    },
    async getUserProfile(uid) {
      if (!uid) throw new Error('მომხმარებლის იდენტიფიკატორი არასწორია.');
      const userSnapshot = await users.doc(String(uid)).get();
      const snapshot = userSnapshot.exists ? userSnapshot : await legacyUserProfiles.doc(String(uid)).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async createOrder(order) {
      const user = firebase.auth?.().currentUser;
      if (!user || !(await user.getIdTokenResult(true)).claims.email_verified) {
        throw new Error('შეკვეთის ისტორიისთვის საჭიროა დადასტურებული Firebase ანგარიში.');
      }
      if (!Array.isArray(order.items) || order.items.length < 1 || order.items.length > 20) {
        throw new Error('შეკვეთის ნივთების სია არასწორია.');
      }
      const items = order.items.map(item => ({
        productId: String(item.productId || '').slice(0, 160),
        name: String(item.name || '').slice(0, 160),
        image: String(item.image || '').slice(0, 2048),
        price: Number(item.price)
      }));
      if (items.some(item => !item.productId || !item.name || !Number.isFinite(item.price) || item.price <= 0)) {
        throw new Error('შეკვეთის ნივთის მონაცემები არასწორია.');
      }
      const total = Number(order.total);
      if (!Number.isFinite(total) || total <= 0) throw new Error('შეკვეთის ჯამი არასწორია.');
      const ref = db.collection('orders').doc();
      const record = {
        buyerUid: user.uid,
        buyerEmail: user.email || '',
        buyerName: String(order.buyerName || '').trim().slice(0, 160),
        buyerPhone: String(order.buyerPhone || '').trim().slice(0, 64),
        deliveryAddress: String(order.deliveryAddress || '').trim().slice(0, 500),
        sellerId: String(order.sellerId || '').slice(0, 160),
        items,
        total,
        paymentStatus: 'simulated',
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await ref.set(record);
      return { ...record, id: ref.id };
    },
    subscribeUserOrders(onChange, onError) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('შეკვეთების სანახავად საჭიროა შესვლა.');
      return db.collection('orders').where('buyerUid', '==', user.uid)
        .limit(100).onSnapshot(snapshot => {
          onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
        }, onError);
    },
    async subscribeAdminOrders(onChange, onError) {
      await requireAdmin();
      return db.collection('orders').orderBy('createdAt', 'desc').limit(500).onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    async updateOrderStatus(id, status) {
      if (!['shipped', 'delivered'].includes(status) || !id) {
        throw new Error('შეკვეთის სტატუსი არასწორია.');
      }
      await requireAdmin();
      const ref = db.collection('orders').doc(String(id));
      const now = new Date();
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.exists ? snapshot.data().status : '';
        const valid = (current === 'pending' && status === 'shipped')
          || (current === 'shipped' && status === 'delivered');
        if (!valid) throw new Error('შეკვეთის სტატუსი უკვე შეიცვალა ან გადასვლა დაუშვებელია.');
        const updates = {
          status,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (status === 'shipped') updates.shippedAt = firebase.firestore.FieldValue.serverTimestamp();
        if (status === 'delivered') {
          updates.deliveredAt = firebase.firestore.FieldValue.serverTimestamp();
          updates.releaseAt = firebase.firestore.Timestamp.fromDate(new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000));
          updates.escrowStatus = 'held';
        }
        transaction.update(ref, updates);
      });
      await writeAudit('update-order-status', 'orders', id, { status });
    },
    async subscribeAdminProducts(onChange, onError) {
      const user = firebase.auth?.().currentUser;
      if (!user
        || (await user.getIdTokenResult()).claims.admin !== true) {
        throw new Error('ადმინისტრატორის Firebase ანგარიშია საჭირო.');
      }
      return products.onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, onError);
    },
    async subscribeAdminUsers(onChange, onError) {
      await requireAdmin();
      let currentUsers = [];
      let legacyProfiles = [];
      const publish = () => {
        const merged = new Map(legacyProfiles.map(user => [String(user.id), user]));
        currentUsers.forEach(user => merged.set(String(user.id), user));
        onChange([...merged.values()].sort((left, right) => {
          const dateOf = value => typeof value?.toDate === 'function' ? value.toDate().getTime() : new Date(value || 0).getTime();
          return dateOf(right.createdAt) - dateOf(left.createdAt);
        }));
      };
      const unsubscribeUsers = users.onSnapshot(snapshot => {
        currentUsers = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, profileCollection: 'users' }));
        publish();
      }, onError);
      const unsubscribeLegacy = legacyUserProfiles.onSnapshot(snapshot => {
        legacyProfiles = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, profileCollection: 'userProfiles' }));
        publish();
      }, onError);
      return () => {
        unsubscribeUsers();
        unsubscribeLegacy();
      };
    },
    async updateAdminUser(id, profileCollection, updates) {
      const collection = profileCollection === 'userProfiles' ? legacyUserProfiles : profileCollection === 'users' ? users : null;
      const allowedFields = ['verified', 'vip', 'banned', 'bonusTier', 'freeBoosts', 'commissionDiscount'];
      const fields = Object.keys(updates || {});
      const validBonus = fields.length === 3
        && updates.bonusTier in { none: true, bronze: true, silver: true, gold: true }
        && Number.isInteger(updates.freeBoosts) && updates.freeBoosts >= 0 && updates.freeBoosts <= 100
        && Number.isFinite(updates.commissionDiscount) && updates.commissionDiscount >= 0 && updates.commissionDiscount <= 100;
      const validStatus = fields.length === 1 && allowedFields.includes(fields[0])
        && typeof updates[fields[0]] === 'boolean';
      if (!id || !collection || (!validBonus && !validStatus)) {
        throw new Error('მომხმარებლის განახლების მონაცემები არასწორია.');
      }
      await requireAdmin();
      await collection.doc(String(id)).update({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await writeAudit(validBonus ? 'update-seller-bonus' : 'update-user-status', 'users', id, updates);
    },
    async uploadAdminMedia(file, folder) {
      await requireAdmin();
      if (!(file instanceof File) || !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
        throw new Error('აირჩიე 10 მბ-მდე ზომის სურათი.');
      }
      if (!['sponsors', 'ads'].includes(folder)) throw new Error('ატვირთვის საქაღალდე არასწორია.');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ref = bucket.ref(`${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName}`);
      await ref.put(file, { contentType: file.type });
      return { url: await ref.getDownloadURL(), path: ref.fullPath };
    },
    async saveAdminSiteConfig(updates) {
      await requireAdmin();
      const allowed = ['tickerMessage', 'partnerName', 'partnerDescription', 'partnerWebsiteUrl', 'partnerLogoUrl'];
      const fields = Object.keys(updates || {});
      if (!fields.length || fields.some(field => !allowed.includes(field))
        || fields.some(field => typeof updates[field] !== 'string' || updates[field].length > 1200)) {
        throw new Error('საიტის პარამეტრები არასწორია.');
      }
      await db.collection('siteConfig').doc('public').set({
        ...updates,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await writeAudit('update-site-config', 'siteConfig', 'public', { fields });
    },
    async openChat(productId) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('ჩატისთვის საჭიროა ანგარიშში შესვლა.');
      if (!productId) throw new Error('ნამუშევარი ვერ მოიძებნა.');
      const productSnapshot = await products.doc(String(productId)).get();
      if (!productSnapshot.exists || productSnapshot.data().approvalStatus !== 'Approved') {
        throw new Error('ეს ნამუშევარი ჩატისთვის ხელმისაწვდომი არ არის.');
      }
      const product = productSnapshot.data();
      const sellerUid = String(product.sellerUid || '');
      if (!sellerUid) throw new Error('ამ განცხადების ავტორს ჩატი ჯერ არ აქვს ჩართული.');
      if (sellerUid === user.uid) throw new Error('საკუთარ განცხადებაზე შეტყობინებას ვერ გაგზავნი.');
      const participants = [user.uid, sellerUid].sort();
      const chatId = [productSnapshot.id, ...participants].map(encodeURIComponent).join('__');
      const chatRef = chats.doc(chatId);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(chatRef);
        if (snapshot.exists) {
          const chat = snapshot.data();
          if (chat.productId !== productSnapshot.id
            || !Array.isArray(chat.participants)
            || participants.some(participant => !chat.participants.includes(participant))) {
            throw new Error('ჩატის მონაცემები არ ემთხვევა ნამუშევარს.');
          }
          return;
        }
        transaction.set(chatRef, {
          chatId,
          participants,
          productId: productSnapshot.id,
          lastMessage: '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      return { chatId, sellerUid, productId: productSnapshot.id };
    },
    subscribeChatMessages(chatId, onChange, onError) {
      if (!chatId) throw new Error('ჩატის მითითება სავალდებულოა.');
      return chats.doc(String(chatId)).collection('messages').orderBy('timestamp', 'desc').limit(200).onSnapshot(snapshot => {
        onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).reverse());
      }, onError);
    },
    async sendChatMessage(chatId, text) {
      const user = firebase.auth?.().currentUser;
      const message = String(text || '').trim();
      if (!user) throw new Error('შეტყობინების გასაგზავნად ანგარიშში შესვლა საჭიროა.');
      if (!chatId || !message || message.length > 2000) throw new Error('შეტყობინება ცარიელია ან ზედმეტად გრძელია.');
      const chatRef = chats.doc(String(chatId));
      const messageRef = chatRef.collection('messages').doc();
      const timestamp = firebase.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(messageRef, {
        senderId: user.uid,
        text: message,
        timestamp,
        read: false
      });
      batch.update(chatRef, { lastMessage: message, updatedAt: timestamp });
      await batch.commit();
    },
    async markChatMessagesRead(chatId, messageIds) {
      const user = firebase.auth?.().currentUser;
      if (!user) throw new Error('შეტყობინებების წასაკითხად ანგარიშში შესვლა საჭიროა.');
      const ids = [...new Set((messageIds || []).map(String).filter(Boolean))].slice(0, 200);
      if (!chatId || !ids.length) return;
      const batch = db.batch();
      ids.forEach(id => batch.update(chats.doc(String(chatId)).collection('messages').doc(id), { read: true }));
      await batch.commit();
    },
    subscribeSettings(onChange, onError) {
      return settings.onSnapshot(snapshot => onChange(snapshot.exists ? snapshot.data() : {}), onError);
    },
    async createProduct(product, file) {
      const ref = products.doc();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileRef = bucket.ref(`products/${ref.id}/${Date.now()}-${safeName}`);
      await fileRef.put(file, { contentType: file.type });
      try {
        const mediaUrl = await fileRef.getDownloadURL();
        const { sellerIban, ...publicProduct } = product;
        const record = {
          ...publicProduct,
          id: ref.id,
          image: mediaUrl,
          mediaUrl,
          storagePath: fileRef.fullPath,
          mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          fileName: file.name,
          approvalStatus: 'Pending',
          createdAt: new Date().toISOString()
        };
        await ref.set({ ...record, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        return record;
      } catch (error) {
        await fileRef.delete().catch(cleanupError => {
          console.error('Unable to remove the uploaded file after Firestore failed.', cleanupError);
        });
        throw error;
      }
    },
    updateProduct(id, updates) {
      return requireAdmin().then(async () => {
        await products.doc(String(id)).update(updates);
        await writeAudit('update-product', 'products', id, { fields: Object.keys(updates) });
      });
    },
    deleteProduct(id) {
      return requireAdmin().then(() => products.doc(String(id)).get()).then(async snapshot => {
        if (!snapshot.exists) return;
        const product = snapshot.data();
        if (product.storagePath) await bucket.ref(product.storagePath).delete();
        await snapshot.ref.delete();
        await writeAudit('delete-product', 'products', id);
      });
    },
    saveCommissionRate(rate) {
      return requireAdmin().then(async () => {
        await settings.set({ commissionRate: rate }, { merge: true });
        await writeAudit('update-commission-rate', 'settings', 'platform', { commissionRate: rate });
      });
    },
    signOutAdmin() { return firebase.auth().signOut(); }
  };
  window.DropZoneFirebaseStatus = { ready: true, code: 'ready', message: '' };
})();

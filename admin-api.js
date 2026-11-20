(() => {
  const endpoint = '/api/admin';
  const listeners = new Set();
  let latestSnapshot = null;
  let pollTimer = null;
  let polling = false;
  let sessionExpired = false;

  function makeError(data, status) {
    const error = new Error(data?.message || `Admin API request failed (${status}).`);
    error.code = data?.error || 'admin_api_failed';
    error.status = status;
    return error;
  }

  function notifySessionExpired(error) {
    if (error?.status !== 401 || sessionExpired) return;
    sessionExpired = true;
    document.dispatchEvent(new Event('dropzone-admin-session-expired'));
  }

  async function request(method, body) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(endpoint, options);
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json() : {};
    if (!response.ok) {
      const error = makeError(data, response.status);
      notifySessionExpired(error);
      throw error;
    }
    return data;
  }

  async function call(action, payload = {}) {
    const response = await request('POST', { action, ...payload });
    if (action !== 'snapshot') refreshSoon();
    return response.result;
  }

  async function poll() {
    if (polling || !listeners.size) return;
    polling = true;
    try {
      latestSnapshot = await call('snapshot');
      sessionExpired = false;
      listeners.forEach(listener => {
        try {
          listener.onChange(latestSnapshot);
        } catch (error) {
          console.error('Unable to render admin data snapshot.', error);
        }
      });
    } catch (error) {
      listeners.forEach(listener => listener.onError(error));
    } finally {
      polling = false;
    }
  }

  function refreshSoon() {
    if (!listeners.size) return;
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, 150);
  }

  function subscribe(onChange, onError) {
    const listener = { onChange, onError: onError || (error => console.error(error)) };
    listeners.add(listener);
    if (latestSnapshot) onChange(latestSnapshot);
    if (!pollTimer) poll();
    if (!subscribe.interval) subscribe.interval = window.setInterval(poll, 10000);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        window.clearTimeout(pollTimer);
        window.clearInterval(subscribe.interval);
        pollTimer = null;
        subscribe.interval = null;
        latestSnapshot = null;
      }
    };
  }

  function collectionSubscription(collection, onChange, onError) {
    return subscribe(snapshot => onChange(snapshot[collection] || []), onError);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('სურათის წაკითხვა ვერ მოხერხდა.'));
      reader.readAsDataURL(file);
    });
  }

  window.DropZoneAdminApi = {
    async getSession() {
      try {
        const result = await request('GET');
        sessionExpired = false;
        return result;
      } catch (error) {
        if (error.status === 401) return { authenticated: false };
        throw error;
      }
    },
    login(pin) {
      return request('POST', { action: 'login', pin }).then(result => {
        sessionExpired = false;
        return result;
      });
    },
    logout() {
      return request('DELETE').finally(() => {
        sessionExpired = false;
      });
    },
    subscribeAdminProducts(onChange, onError) {
      return collectionSubscription('products', onChange, onError);
    },
    subscribeAdminPayments(onChange, onError) {
      return collectionSubscription('paymentRequests', onChange, onError);
    },
    subscribeAdminUsers(onChange, onError) {
      return subscribe(snapshot => {
        const merged = new Map((snapshot.userProfiles || []).map(user => [String(user.id), {
          ...user, profileCollection: 'userProfiles'
        }]));
        (snapshot.users || []).forEach(user => merged.set(String(user.id), {
          ...user, profileCollection: 'users'
        }));
        onChange([...merged.values()].sort((left, right) => {
          const dateOf = value => new Date(value || 0).getTime();
          return dateOf(right.createdAt) - dateOf(left.createdAt);
        }));
      }, onError);
    },
    subscribeAdminCollection(collection, onChange, onError) {
      return collectionSubscription(collection, onChange, onError);
    },
    subscribeAdminOrders(onChange, onError) {
      return Promise.resolve(collectionSubscription('orders', onChange, onError));
    },
    subscribeSettings(onChange, onError) {
      return subscribe(snapshot => onChange(snapshot.settings || {}), onError);
    },
    subscribeSiteConfig(onChange, onError) {
      return subscribe(snapshot => onChange(snapshot.siteConfig || {}), onError);
    },
    createAdminRecord(collection, data) {
      return call('create-record', { collection, data });
    },
    updateAdminRecord(collection, id, updates) {
      return call('update-record', { collection, id, updates });
    },
    deleteAdminRecord(collection, id) {
      return call('delete-record', { collection, id });
    },
    updateProduct(id, updates) {
      return call('update-product', { id, updates });
    },
    deleteProduct(id) {
      return call('delete-product', { id });
    },
    updateAdminUser(id, profileCollection, updates) {
      return call('update-user', { id, profileCollection, updates });
    },
    updateAdminPayment(id, status) {
      return call('update-payment', { id, status });
    },
    saveCommissionRate(rate) {
      return call('save-commission', { rate });
    },
    updateOrderStatus(id, status) {
      return call('update-order', { id, status });
    },
    approveVendor(id, updates) {
      return call('approve-vendor', { id, updates });
    },
    setVendorBlocked(id, blocked) {
      return call('set-vendor-blocked', { id, blocked });
    },
    recordDisputeRefund(disputeId, transactionId) {
      return call('record-dispute-refund', { disputeId, transactionId });
    },
    async uploadAdminMedia(file, folder) {
      if (!(file instanceof File) || file.size > 2 * 1024 * 1024) {
        throw new Error('აირჩიე 2 მბ-მდე ზომის სურათი.');
      }
      return call('upload-media', {
        folder,
        file: { fileName: file.name, mimeType: file.type, base64: await fileToBase64(file) }
      });
    },
    saveAdminSiteConfig(updates) {
      return call('save-site-config', { updates });
    }
  };
})();

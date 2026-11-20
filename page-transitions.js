(() => {
  const duration = 350;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let isNavigating = false;

  if (!reducedMotion.matches) {
    document.documentElement.classList.add('page-is-entering');
    window.setTimeout(() => {
      document.documentElement.classList.remove('page-is-entering');
    }, 550);
  }

  document.addEventListener('click', event => {
    if (reducedMotion.matches || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (isNavigating) {
      event.preventDefault();
      return;
    }

    const target = event.target;
    const link = target instanceof Element ? target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') ||
        (link.target && link.target !== '_self') ||
        link.relList.contains('external')) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin ||
        !['http:', 'https:'].includes(destination.protocol)) return;

    const current = new URL(window.location.href);
    if (destination.pathname === current.pathname &&
        destination.search === current.search) return;

    event.preventDefault();
    isNavigating = true;
    document.documentElement.classList.remove('page-is-entering');
    document.documentElement.classList.add('page-is-leaving');
    window.setTimeout(() => window.location.assign(destination.href), duration);
  });

  window.addEventListener('pageshow', event => {
    isNavigating = false;
    document.documentElement.classList.remove('page-is-leaving');
    if (event.persisted) document.documentElement.classList.remove('page-is-entering');
  });
})();

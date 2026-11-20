module.exports = async function checkoutSession(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!process.env.PAYMENT_API_KEY) {
    return res.status(503).json({ error: 'payment_provider_not_configured' });
  }

  return res.status(501).json({ error: 'payment_provider_adapter_not_implemented' });
};

import { handleCatalogRequest } from '../../server/catalog-service.mjs';

export default async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  let body = null;
  if (request.method === 'POST') {
    body = typeof request.body === 'object' ? request.body : await new Promise(resolve => {
      let raw = '';
      request.on('data', chunk => { raw += chunk; });
      request.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : null); } catch { resolve(null); }
      });
    });
  }
  const result = await handleCatalogRequest({ method: request.method, pathname: url.pathname, searchParams: url.searchParams, body });
  Object.entries(result.headers).forEach(([key, value]) => response.setHeader(key, value));
  response.status(result.status).json(result.payload);
}

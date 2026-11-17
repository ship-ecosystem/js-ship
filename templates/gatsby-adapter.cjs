const fs = require('node:fs');
const path = require('node:path');
const builtInHeaders = new Map([
  ['cache-control', ['public, max-age=0, must-revalidate', 'public, max-age=31536000, immutable']],
  ['x-xss-protection', ['1; mode=block']], ['x-content-type-options', ['nosniff']],
  ['referrer-policy', ['same-origin']], ['x-frame-options', ['DENY']],
]);
module.exports = () => ({
  name: 'gatsby-adapter-ship-static',
  config() { return { supports: { pathPrefix: false, trailingSlash: ['always'] } }; },
  async adapt({ routesManifest, functionsManifest, pathPrefix, headerRoutes = [] }) {
    const paths = new Set(routesManifest.map(route => route.path));
    const customHeaders = headerRoutes.filter(route =>
      !['/*', '/static/*'].includes(route.path) && !paths.has(route.path) ||
      !Array.isArray(route.headers) || route.headers.some(header => !builtInHeaders.get(header.key?.toLowerCase())?.includes(header.value)));
    if (functionsManifest.length || customHeaders.length || routesManifest.some(route => route.type !== 'static' || /[:*]/.test(route.path || ''))) {
      const details = { functions: functionsManifest.length, headers: customHeaders.map(route => route.path).slice(0, 5),
        routes: routesManifest.filter(route => route.type !== 'static' || /[:*]/.test(route.path || '')).slice(0, 5).map(route => ({ type: route.type, path: route.path })) };
      throw new Error('Ship Gatsby static packaging does not support SSR, DSG, functions, custom redirects/headers or wildcard client routes. ' + JSON.stringify(details));
    }
    fs.writeFileSync(path.join(process.cwd(), 'ship/.gatsby-static.json'), JSON.stringify({ static: true, pathPrefix: pathPrefix || '' }));
  }
});

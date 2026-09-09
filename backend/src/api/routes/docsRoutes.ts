import { Router } from 'express';
import { openapi } from '../docs/openapi.js';

export function createDocsRoutes(): Router {
  const router = Router();

  router.get('/docs/openapi.json', (req, res) => {
    res.json(openapi);
  });

  router.get('/docs', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MENTORA API Documentation</title>
          <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
          <script>
            window.onload = function() {
              window.ui = SwaggerUIBundle({
                url: '/api/v1/docs/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                  SwaggerUIBundle.presets.apis,
                  SwaggerUIBundle.SwaggerUIStandalonePreset
                ],
                plugins: [
                  SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: 'BaseLayout',
                validatorUrl: null,
              });
            };
          </script>
        </body>
      </html>
    `);
  });

  return router;
}

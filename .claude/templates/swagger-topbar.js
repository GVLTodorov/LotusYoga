// Swagger UI top-bar link buttons (horizontal row, outlined green, fill on hover).
// links: [label, url] pairs — add more pairs to get more buttons.
export function swaggerTopBar(links = [['UI', process.env.UI_URL ?? 'http://localhost:5173']]) {
  const customCss = `
    /* Scoped under .swagger-ui .topbar to outrank Swagger UI's own
       '.swagger-ui nav { display: block }' and '.swagger-ui .topbar a' rules. */
    .swagger-ui .topbar .app-links {
      display: flex; flex-direction: row; flex: 0 0 auto; gap: 8px;
      margin-left: 24px; align-items: center;
    }
    .swagger-ui .topbar .app-links a {
      flex: 0 0 auto; max-width: none;
      color: #fff; font-weight: 600; font-size: 14px; text-decoration: none;
      padding: 6px 14px; border: 2px solid #62a03f; border-radius: 4px;
    }
    .swagger-ui .topbar .app-links a:hover { background: #62a03f; }
  `;

  const customJsStr = `
    (function () {
      var links = ${JSON.stringify(links)};
      var timer = setInterval(function () {
        var bar = document.querySelector('.topbar-wrapper');
        if (!bar) return;
        clearInterval(timer);
        var nav = document.createElement('nav');
        nav.className = 'app-links';
        links.forEach(function (link) {
          var a = document.createElement('a');
          a.textContent = link[0];
          a.href = link[1];
          a.target = '_blank';
          a.rel = 'noopener';
          nav.appendChild(a);
        });
        bar.insertBefore(nav, bar.querySelector('.download-url-wrapper'));
      }, 50);
    })();
  `;

  return { customCss, customJsStr };
}

// Express usage:
//   const { customCss, customJsStr } = swaggerTopBar();
//   app.use('/swagger', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customCss, customJsStr }));
//   app.get('/swagger.json', (_req, res) => res.json(openApiSpec));
// Fastify (@fastify/swagger-ui): pass them as theme.css / theme.js entries.

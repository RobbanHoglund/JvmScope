import { defineConfig } from "vite";
import { resolve } from "node:path";
import { FRONTEND_PORT, HOST } from "../scripts/local-dev-config.mjs";
import { projectLegalFiles } from "../scripts/project-legal.mjs";
import { ARTICLES } from './assets/javautils/knowledge/data.js';
const knowledgeInputs = Object.fromEntries(['index', ...ARTICLES.map(a => a.id)].map(id => [`knowledge-${id}`, resolve(import.meta.dirname, `knowledge/${id}.html`)]));

const rootDir = import.meta.dirname;

// Use the root license/notice sources in every frontend delivery target.
export function projectLegalNotices() {
  return {
    name: 'project-legal-notices',
    apply: 'build',
    generateBundle() {
      for (const file of projectLegalFiles()) this.emitFile({ type: 'asset', ...file });
    },
  };
}

// Keep bookmarks working in development and the production preview.
function analyzerRedirects() {
  const install = server => {
    server.middlewares.use((request, response, next) => {
      const url = request.url || '';
      const queryOffset = url.indexOf('?');
      const path = queryOffset < 0 ? url : url.slice(0, queryOffset);
      if (!['GET', 'HEAD'].includes(request.method) || !['/javautils/tda.html', '/javautils/tls.html'].includes(path)) return next();
      response.writeHead(308, {
        Location: path.replace('/javautils/', '/jvmscope/') + (queryOffset < 0 ? '' : url.slice(queryOffset)),
        'Cache-Control': 'no-store',
      });
      response.end();
    });
  };
  return { name: 'analyzer-route-redirects', configureServer: install, configurePreviewServer: install };
}

// Home, analyzers and knowledge pages ship together on Java and static Pages.
// Separate output directories keep preview and application assets independent.
export function toolNavigation({ slim = false } = {}) {
  let base = '/';
  return {
    name: 'tool-navigation',
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const active = context.filename.includes('knowledge') ? 'knowledge' : context.filename.endsWith('tls.html') ? 'tls'
          : context.filename.endsWith('tda.html') ? 'tda' : 'home';
        const link = (name, path, label) => `<a href="${path}"${active === name ? ' aria-current="page"' : ''}>${label}</a>`;
        const navigation = `<nav class="tool-nav" aria-label="Analysis tools"><a class="tool-nav-home" href="${base}"${active === 'home' ? ' aria-current="page"' : ''}>JvmScope home</a>${link('tda', `${base}jvmscope/tda.html`, 'Thread dumps')}${link('tls', `${base}jvmscope/tls.html`, 'TLS log analyzer')}${link('knowledge', `${base}knowledge/index.html`, 'Knowledge base')}</nav>`;
        // Reuse the brand asset and let Vite apply the delivery target's base.
        // Keep each analyzer's own icon; home/knowledge pages need a default.
        const icon = /<link\b[^>]*\brel=["']icon["']/i.test(html) ? ''
          : '<link rel="icon" type="image/svg+xml" href="/assets/javautils/java-thread-mark.svg" />\n';
        return html.replace('</head>', `${icon}<link rel="stylesheet" href="/assets/tool-navigation.css" />\n</head>`)
          .replace(/(<body\b[^>]*>)/, `$1\n${navigation}`);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [analyzerRedirects(), toolNavigation({ slim: ['slim', 'pages'].includes(mode) }), projectLegalNotices()],
  root: rootDir,
  base: "/",
  // Removed or misspelled tool URLs must return 404 rather than the portal HTML.
  appType: "mpa",

  worker: {
    rollupOptions: {
      output: {
        // TDA's analysis worker belongs with immutable scripts in both builds.
        entryFileNames: chunk => chunk.name === "analysis-worker"
          ? "assets/js/worker-[name]-[hash].js"
          : "assets/[name]-[hash].js",
      },
    },
  },

  server: {
    host: HOST,
    port: FRONTEND_PORT,
    strictPort: true,
  },

  build: {
    outDir: resolve(rootDir, mode === 'pages' ? "../build/pages" : mode === 'slim' ? "../slim/build/frontend" : "../build/frontend"),
    emptyOutDir: true,
    minify: mode !== "development",
    // Small teaching captures must remain fetchable files, including JSON/TXT excerpts.
    assetsInlineLimit: filePath => /\.(txt|json)$/i.test(filePath) ? false : undefined,

    rollupOptions: {
      input: ['slim', 'pages'].includes(mode) ? {
        main: resolve(rootDir, 'index.html'),
        ...knowledgeInputs,
        tda: resolve(rootDir, "jvmscope/tda.html"),
        tls: resolve(rootDir, "jvmscope/tls.html"),
      } : {
        ...knowledgeInputs,
        main: resolve(rootDir, "index.html"),
        utils: resolve(rootDir, "utils.html"),
        tda: resolve(rootDir, "jvmscope/tda.html"),
        tls: resolve(rootDir, "jvmscope/tls.html"),
      },

      output: {
        entryFileNames: "assets/js/[name]-[hash].js",
        chunkFileNames: "assets/js/chunk-[name]-[hash].js",
        assetFileNames: ({ names }) => {
          const fileName = names[0] || "";

          if (fileName.endsWith(".css")) {
            return "assets/css/[name]-[hash][extname]";
          }

          if (/\.(png|jpe?g|gif|svg|webp)$/i.test(fileName)) {
            return "assets/img/[name][extname]";
          }

          if (/\.(woff2?|ttf|otf|eot)$/i.test(fileName)) {
            return "assets/fonts/[name][extname]";
          }

          if (/\.(txt|json)$/i.test(fileName)) {
            return "assets/examples/[name]-[hash][extname]";
          }

          return "assets/[name][extname]";
        },
      },
    },
  },
}));

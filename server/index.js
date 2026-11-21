import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { rootDir, server as serverConfig, dataDir, databasePath, access } from './config.js';
import { db } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { sessionUser } from './lib/session.js';
import { companiesRouter } from './routes/companies.js';
import { jobsRouter } from './routes/jobs.js';
import { dashboardRouter } from './routes/dashboard.js';
import { settingsRouter } from './routes/settings.js';
import { integrationsRouter } from './routes/integrations.js';
import { emailsRouter } from './routes/emails.js';
import { activityRouter } from './routes/activity.js';
import { exportRouter } from './routes/export.js';
import { outreachRouter } from './routes/outreach.js';
import { recoverJobs } from './services/jobs.js';
import { logActivity } from './lib/activity.js';

if (serverConfig.nodeEnv === 'production' && !access.enabled && !access.allowPublicNoAuth) {
  console.error(
    '[app] Refusing to start: NODE_ENV=production requires AUTH_PASSWORD so the app is not exposed publicly. ' +
      'Set AUTH_PASSWORD (and AUTH_USERNAME if you want a different login) or, only on a trusted private network, ALLOW_PUBLIC_NO_AUTH=true.',
  );
  process.exit(1);
}
if (access.enabled) {
  console.log(`[app] Access control enabled for user "${access.username}".`);
  if (serverConfig.host !== '127.0.0.1' && serverConfig.host !== 'localhost') {
    console.log('[app] Listening beyond localhost; keep the configured password strong and serve over HTTPS.');
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const PUBLIC_API_ROUTES = new Set([
  '/api/health',
  '/api/auth/session',
  '/api/auth/login',
  '/api/auth/logout',
]);

/**
 * Protects the API with either a signed HttpOnly session cookie (the React
 * login page) or HTTP Basic Auth (scripts, curl and hosting checks). Static
 * files stay public so the login page can load. Enabled whenever AUTH_PASSWORD
 * is set, and mandatory in production.
 */
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (!access.enabled) return next();
  if (PUBLIC_API_ROUTES.has(req.path)) return next();
  // Google redirects the browser here without credentials. The one-time state
  // parameter is validated during token exchange.
  if (req.method === 'GET' && req.path === '/api/integrations/google/callback') return next();
  if (sessionUser(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return next();
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json({
    error: { message: 'Authentication required', code: 'unauthorized' },
  });
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/api/health', (req, res) => {
  const check = db.prepare('SELECT COUNT(*) AS count FROM companies').get();
  res.json({
    ok: true,
    version: '0.1.0',
    database: { path: databasePath, companies: check.count },
    dataDir,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/companies', companiesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/export', exportRouter);
app.use('/api/outreach', outreachRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: `Unknown API route: ${req.method} ${req.originalUrl}` } });
});

const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .type('text')
      .send(
        'API is running. The dashboard build was not found — run "npm run dev" for development, or "npm run build" for a production build.',
      );
  });
}

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const status =
    error.status ||
    (error.name === 'ValidationError' ? 400 : error.name === 'ConflictError' ? 409 : error.name === 'NotFoundError' ? 404 : null) ||
    (error.code === 'integration_not_configured' ? 409 : 500);

  if (status >= 500) {
    console.error('[api:error]', req.method, req.originalUrl, error);
    if (error.stack) console.error(error.stack.split('\n').slice(0, 6).join('\n'));
  }

  res.status(status).json({
    error: {
      message: error.message || 'Unexpected server error',
      code: error.code || (status >= 500 ? 'server_error' : 'request_error'),
      integration: error.integration || undefined,
      env: error.env?.length ? error.env : undefined,
      details: error.details || undefined,
    },
  });
});

recoverJobs();
logActivity({ action: 'server_started', message: `Server listening on ${serverConfig.host}:${serverConfig.port}` });
console.log(`SQLite database: ${databasePath}`);

const server = app.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`API ready on http://localhost:${serverConfig.port}`);
  if (serverConfig.nodeEnv === 'development') {
    console.log('Dashboard (dev): http://localhost:5173');
  }
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

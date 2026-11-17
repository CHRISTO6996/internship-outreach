import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rootDir, server as serverConfig, dataDir, databasePath, access } from './config.js';
import { db } from './db/index.js';
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

function secureEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * HTTP Basic Auth guard. Enabled whenever AUTH_PASSWORD is set, and mandatory
 * in production. Health checks stay public so hosting platforms can probe them.
 */
app.use((req, res, next) => {
  if (!access.enabled) return next();
  if (req.path === '/api/health') return next();
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator === -1 ? decoded : decoded.slice(0, separator);
    const password = separator === -1 ? '' : decoded.slice(separator + 1);
    if (secureEqual(username, access.username) && secureEqual(password, access.password)) {
      res.setHeader('Cache-Control', 'no-store');
      return next();
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Internship Outreach", charset="UTF-8"');
  res.status(401).type('text').send('Authentication required');
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

import { Router } from 'express';
import { z } from 'zod';
import { access } from '../config.js';
import { parseBody } from '../lib/validate.js';
import {
  clearSessionCookie,
  credentialsMatch,
  sessionUser,
  setSessionCookie,
} from '../lib/session.js';

export const authRouter = Router();

authRouter.get('/session', (req, res) => {
  const username = sessionUser(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    authenticated: Boolean(username),
    user: username ? { username } : null,
    authRequired: access.enabled,
  });
});

authRouter.post('/login', (req, res, next) => {
  try {
    if (!access.enabled) {
      res.status(400).json({
        error: {
          message: 'No login is configured. Set AUTH_USERNAME and AUTH_PASSWORD in the backend .env file.',
          code: 'login_not_configured',
        },
      });
      return;
    }
    const body = parseBody(
      z.object({
        username: z.string().trim().min(1).max(200),
        password: z.string().min(1).max(500),
      }),
      req.body,
    );
    if (!credentialsMatch(body.username, body.password)) {
      res.status(401).json({
        error: { message: 'Incorrect username or password.', code: 'invalid_credentials' },
      });
      return;
    }
    setSessionCookie(req, res, body.username);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ authenticated: true, user: { username: body.username } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

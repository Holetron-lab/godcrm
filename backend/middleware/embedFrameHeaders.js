const LEVEL_PARENT_ORIGIN = 'https://admin.sixtynine.ru';

export function embedFrameHeaders(req, res, next) {
  if (req.path !== '/embed/chat' || process.env.EMBED_TICKET_AUTH_ENABLED !== 'true') {
    return next();
  }

  res.removeHeader('X-Frame-Options');
  const current = String(res.getHeader('Content-Security-Policy') || '');
  const directives = current.split(';').map((value) => value.trim()).filter(Boolean);
  const frameIndex = directives.findIndex((value) => value.startsWith('frame-ancestors '));
  if (frameIndex === -1) {
    directives.push(`frame-ancestors ${LEVEL_PARENT_ORIGIN}`);
  } else {
    const origins = new Set(directives[frameIndex].split(/\s+/).slice(1));
    origins.add(LEVEL_PARENT_ORIGIN);
    directives[frameIndex] = `frame-ancestors ${[...origins].join(' ')}`;
  }
  res.setHeader('Content-Security-Policy', directives.join('; '));
  next();
}

export default embedFrameHeaders;

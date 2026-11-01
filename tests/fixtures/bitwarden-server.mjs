// A stand-in Bitwarden server, enough of one for the Bitwarden extension to sign in, sync its vault and
// save new logins (tests/e2e/passwords.mjs). One account, made the way Bitwarden's apps make one: the
// vault key is encrypted with a key derived from the master password (PBKDF2-SHA256, then HKDF), and
// every item's fields with the vault key, so the extension decrypts them itself.
//
//   const bw = await startBitwarden({ logins: [{ name, username, password, uri }], tls: { key, cert } });
// (Bitwarden only talks to a server over HTTPS: give it a certificate, and start Bifrost trusting it.)
//   bw.url, bw.email, bw.password, bw.ciphers (as stored), bw.requests (method + path), bw.stop()
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const ITERATIONS = 600000;

function hkdfExpand(prk, info, len) {
  const out = [];
  let prev = Buffer.alloc(0), n = 0, total = 0;
  while (total < len) {
    n++;
    prev = crypto.createHmac('sha256', prk).update(Buffer.concat([prev, Buffer.from(info), Buffer.from([n])])).digest();
    out.push(prev); total += prev.length;
  }
  return Buffer.concat(out).subarray(0, len);
}
// Bitwarden's "EncString" type 2: AES-256-CBC, then HMAC-SHA256 over iv + ciphertext.
function encString(data, key) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key.enc, iv);
  const ct = Buffer.concat([c.update(Buffer.isBuffer(data) ? data : Buffer.from(String(data))), c.final()]);
  const mac = crypto.createHmac('sha256', key.mac).update(Buffer.concat([iv, ct])).digest();
  return `2.${iv.toString('base64')}|${ct.toString('base64')}|${mac.toString('base64')}`;
}
export function decString(s, key) {
  const [type, rest] = String(s).split('.');
  if (type !== '2') throw new Error('unsupported EncString type ' + type);
  const [iv, ct, mac] = rest.split('|').map((x) => Buffer.from(x, 'base64'));
  const want = crypto.createHmac('sha256', key.mac).update(Buffer.concat([iv, ct])).digest();
  if (!crypto.timingSafeEqual(want, mac)) throw new Error('bad MAC');
  const d = crypto.createDecipheriv('aes-256-cbc', key.enc, iv);
  return Buffer.concat([d.update(ct), d.final()]);
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export async function startBitwarden({ email = 'tamil@bifrost.test', password = 'Correct-Horse-Battery-9', name = 'Tamil', logins = [], tls = null } = {}) {
  const userId = crypto.randomUUID();
  const masterKey = crypto.pbkdf2Sync(password, email.toLowerCase().trim(), ITERATIONS, 32, 'sha256');
  const passwordHash = crypto.pbkdf2Sync(masterKey, password, 1, 32, 'sha256').toString('base64');
  const stretched = { enc: hkdfExpand(masterKey, 'enc', 32), mac: hkdfExpand(masterKey, 'mac', 32) };
  const userKeyRaw = crypto.randomBytes(64);
  const userKey = { enc: userKeyRaw.subarray(0, 32), mac: userKeyRaw.subarray(32) };
  const protectedKey = encString(userKeyRaw, stretched);
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } });
  const publicKey = pair.publicKey.toString('base64');
  const privateKey = encString(pair.privateKey, userKey);
  const accountKeys = { publicKeyEncryptionKeyPair: { wrappedPrivateKey: privateKey, publicKey, signedPublicKey: null, object: 'publicKeyEncryptionKeyPair' }, signatureKeyPair: null, securityState: null, object: 'privateKeys' };
  const kdf = { kdfType: 0, iterations: ITERATIONS, memory: null, parallelism: null };
  const created = new Date(Date.now() - 86400e3).toISOString();
  let revision = Date.now();

  const ciphers = [];
  const cipherOut = (c) => ({ ...c, object: 'cipherDetails' });
  const addLogin = ({ name: n, username, password: pw, uri }) => {
    const now = new Date().toISOString();
    const c = {
      id: crypto.randomUUID(), organizationId: null, folderId: null, type: 1, reprompt: 0, key: null,
      name: encString(n, userKey), notes: null,
      login: { username: encString(username, userKey), password: encString(pw, userKey), totp: null, passwordRevisionDate: null, autofillOnPageLoad: null, fido2Credentials: [],
        uris: [{ uri: encString(uri, userKey), uriChecksum: encString(crypto.createHash('sha256').update(uri).digest('base64'), userKey), match: null }] },
      favorite: false, edit: true, viewPassword: true, permissions: { delete: true, restore: true }, organizationUseTotp: false,
      revisionDate: now, creationDate: now, deletedDate: null, archivedDate: null, collectionIds: [], attachments: null, fields: null, passwordHistory: null,
    };
    ciphers.push(c);
    return c;
  };
  for (const l of logins) addLogin(l);

  const requests = [];
  let base = '';
  const profile = () => ({
    id: userId, name, email, emailVerified: true, premium: true, premiumFromOrganization: false, masterPasswordHint: null, culture: 'en-US',
    twoFactorEnabled: false, key: protectedKey, privateKey, accountKeys, securityStamp: 'stamp-1', forcePasswordReset: false, usesKeyConnector: false,
    avatarColor: null, creationDate: created, verifyDevices: false, organizations: [], providers: [], providerOrganizations: [], object: 'profile',
  });
  const decryption = () => ({ masterPasswordUnlock: { kdf, masterKeyEncryptedUserKey: protectedKey, salt: email.toLowerCase() }, object: 'userDecryption' });
  const token = (deviceId) => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = [b64url({ alg: 'RS256', typ: 'JWT' }), b64url({
      nbf: now - 10, exp: now + 7200, iss: base + '/identity', sub: userId, premium: true, name, email, email_verified: true, sstamp: 'stamp-1',
      device: deviceId || crypto.randomUUID(), devicetype: '2', scope: ['api', 'offline_access'], amr: ['Application'], client_id: 'browser',
    }), Buffer.from('not-signed').toString('base64url')].join('.');
    return {
      access_token: jwt, expires_in: 7200, token_type: 'Bearer', refresh_token: crypto.randomBytes(32).toString('base64url'), scope: 'api offline_access',
      Key: protectedKey, PrivateKey: privateKey, AccountKeys: accountKeys, Kdf: 0, KdfIterations: ITERATIONS, KdfMemory: null, KdfParallelism: null,
      ResetMasterPassword: false, ForcePasswordReset: false, MasterPasswordPolicy: { Object: 'masterPasswordPolicy' }, unofficialServer: true,
      UserDecryptionOptions: { HasMasterPassword: true, Object: 'userDecryptionOptions', MasterPasswordUnlock: { Kdf: { KdfType: 0, Iterations: ITERATIONS, Memory: null, Parallelism: null }, MasterKeyEncryptedUserKey: protectedKey, Salt: email.toLowerCase() } },
    };
  };
  const list = (data) => ({ data, object: 'list', continuationToken: null });

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    requests.push(`${req.method} ${p}`);
    const cors = { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-expose-headers': '*' };
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = {};
    try { body = raw ? (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)) : {}; } catch { body = {}; }
    const m = (re) => re.exec(p);

    if (p === '/api/config' || p === '/config') return send(200, {
      version: '2026.10.0', gitHash: '0000000', server: { name: 'Bifrost test server', url: base },
      environment: { cloudRegion: null, vault: base, api: base + '/api', identity: base + '/identity', notifications: base + '/notifications', sso: '' },
      featureStates: {}, push: { pushTechnology: 0, vapidPublicKey: null }, settings: { disableUserRegistration: true }, object: 'config',
    });
    if (/^\/(identity|api)\/accounts\/prelogin(\/password)?$/.test(p)) return send(200, { kdf: 0, kdfIterations: ITERATIONS, kdfMemory: null, kdfParallelism: null, kdfSettings: kdf, salt: email.toLowerCase() });
    if (p === '/identity/connect/token') {
      if (body.grant_type === 'password') {
        if (String(body.username || '').toLowerCase() !== email.toLowerCase() || body.password !== passwordHash) return send(400, { error: 'invalid_grant', error_description: 'invalid_username_or_password', ErrorModel: { Message: 'Username or password is incorrect. Try again.', Object: 'error' } });
        return send(200, token(body.deviceIdentifier));
      }
      if (body.grant_type === 'refresh_token') return send(200, token());
      return send(400, { error: 'unsupported_grant_type' });
    }
    if (p === '/api/sync') return send(200, {
      profile: profile(), folders: [], collections: [], ciphers: ciphers.map(cipherOut), policies: [], sends: [],
      domains: url.searchParams.get('excludeDomains') === 'true' ? null : { equivalentDomains: [], globalEquivalentDomains: [], object: 'domains' },
      userDecryption: decryption(), object: 'sync',
    });
    if (p === '/api/accounts/revision-date') return send(200, revision);
    if (p === '/api/accounts/profile') return send(200, profile());
    if (p === '/api/accounts/keys') return send(200, { key: protectedKey, publicKey, privateKey, accountKeys, object: 'keys' });
    if (m(/^\/api\/users\/[^/]+\/public-key$/)) return send(200, { userId, publicKey, object: 'userKey' });
    if (p === '/api/devices/knowndevice') return send(200, true);
    if (m(/^\/api\/devices/)) return send(200, {});
    if (p === '/api/ciphers' || p === '/api/ciphers/create') {
      const c = Object.assign({}, body.cipher || body, { id: crypto.randomUUID(), revisionDate: new Date().toISOString(), creationDate: new Date().toISOString(), deletedDate: null, archivedDate: null, edit: true, viewPassword: true, permissions: { delete: true, restore: true }, organizationUseTotp: false, collectionIds: [], attachments: null });
      ciphers.push(c); revision = Date.now();
      return send(200, cipherOut(c));
    }
    let mm = m(/^\/api\/ciphers\/([^/]+)(\/partial)?$/);
    if (mm) {
      const c = ciphers.find((x) => x.id === mm[1]);
      if (!c) return send(404, { message: 'Cipher not found.', object: 'error' });
      if (req.method === 'PUT' || req.method === 'POST') { Object.assign(c, body, { id: c.id, revisionDate: new Date().toISOString() }); revision = Date.now(); }
      return send(200, cipherOut(c));
    }
    if (p === '/api/ciphers') return send(200, list(ciphers.map(cipherOut)));
    if (p === '/api/folders' || p === '/api/collections' || p === '/api/sends' || p === '/api/auth-requests' || p === '/api/tasks' || p === '/api/organizations' || /^\/api\/emergency-access\/(trusted|granted)$/.test(p) || p === '/api/policies') return send(200, list([]));
    if (p === '/api/settings/domains') return send(200, { equivalentDomains: [], globalEquivalentDomains: [], object: 'domains' });
    if (p.startsWith('/notifications')) return send(404, { message: 'no notifications here' });
    return send(404, { message: 'not found: ' + req.method + ' ' + p, object: 'error' });
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
  return {
    url: base, email, password, ciphers, requests, userKey, addLogin,
    // A stored item's fields, decrypted the way the extension would.
    // (An item can carry a key of its own, encrypted with the vault key: then its fields use that one.)
    read: (c) => {
      let k = userKey;
      if (c.key) { const raw = decString(c.key, userKey); k = { enc: raw.subarray(0, 32), mac: raw.subarray(32) }; }
      const d = (v) => (v ? decString(v, k).toString() : null);
      return { name: d(c.name), username: c.login ? d(c.login.username) : null, password: c.login ? d(c.login.password) : null, uris: ((c.login && c.login.uris) || []).map((u) => d(u.uri)) };
    },
    stop: () => { try { server.closeAllConnections(); } catch { /* old node */ } server.close(); },
  };
}

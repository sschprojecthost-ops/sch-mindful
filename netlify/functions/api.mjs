import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = '__Host-sch_mindful';
const EMPLOYEE_CODE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
const LOGIN_DENIED = 'ไม่พบรหัสพนักงานที่เปิดใช้งาน กรุณาตรวจรหัสหรือติดต่อ HR';
const SESSION_LIMIT = 60 * 60;
const MAX_REQUEST_BYTES = 2_750_000;
const ACTIONS = new Set(['home', 'leaderboard', 'stageEvidence', 'submitEvidence', 'adminQueue', 'evidenceImage',
  'reviewEvidence', 'finalizeAwards', 'reopenAwards', 'publishAwards']);
const LOGIN_SETUP_ERRORS = new Map([
  ['ระบบยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแล', 'RELAY_SETUP'],
  ['ตรวจสอบรหัสพนักงานซ้ำหรือข้อมูลไม่ครบในชีต Employees', 'RELAY_ROSTER']
]);

function response(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

function pattern(value, regex, field) {
  if (typeof value !== 'string' || !regex.test(value)) throw new Error('Invalid ' + field);
  return value;
}

function config(env) {
  const siteOrigin = new URL(env.SITE_ORIGIN);
  const local = siteOrigin.hostname === 'localhost' || siteOrigin.hostname === '127.0.0.1';
  if ((!local && siteOrigin.protocol !== 'https:') || siteOrigin.origin !== env.SITE_ORIGIN) throw new Error('Invalid site origin');
  const relayUrl = pattern(env.APPS_SCRIPT_WEB_APP_URL, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'Apps Script URL');
  const relaySecret = pattern(env.RELAY_SECRET, /^[a-fA-F0-9]{64}$/, 'relay secret');
  const sessionSecret = pattern(env.SESSION_SECRET, /^[a-fA-F0-9]{64}$/, 'session secret');
  if (relaySecret === sessionSecret) throw new Error('Use distinct secrets');
  return {origin:siteOrigin.origin,relayUrl,relaySecret,sessionSecret};
}

function employeeCode(value) {
  const raw=typeof value==='string'?value.trim():'';
  const code=raw.toUpperCase();
  return /^[a-zA-Z0-9_-]+$/.test(raw)&&EMPLOYEE_CODE.test(code)?code:'';
}

function hmac(secret, text) {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

function equalMac(value, expected) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}

function readSession(request, cfg, now) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(SESSION_COOKIE + '='));
  if (!cookie || cookie.length > 1200) return null;
  const token = cookie.split('=')[1];
  const match = token.match(/^([a-zA-Z0-9_-]+)\.([a-f0-9]{64})$/);
  if (!match || !equalMac(match[2], hmac(cfg.sessionSecret, 'session.v6\n' + match[1]))) return null;
  try {
    const data = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    return typeof data.code==='string' && EMPLOYEE_CODE.test(data.code) &&
      Number.isInteger(data.exp) && data.exp>now  ? data : null;
  } catch {
    return null;
  }
}

function sessionCookie(value = '', maxAge = 0) {
  return SESSION_COOKIE + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + maxAge;
}

function loginCookie(cfg,code,exp,now) {
  const encoded=Buffer.from(JSON.stringify({code,exp}),'utf8').toString('base64url');
  const value=encoded+'.'+hmac(cfg.sessionSecret,'session.v6\n'+encoded);
  return sessionCookie(value,exp-now);
}
class RelayRequestError extends Error {
  constructor(code, upstreamStatus) {
    super(code);
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

function loginRelayUnavailable(diagnosticCode, upstreamStatus) {
  console.warn('SCH Mindful employee login relay', { diagnosticCode, upstreamStatus });
  return response({
    ok: false,
    error: 'ระบบเชื่อมต่อ Google Workspace ไม่สำเร็จ กรุณาติดต่อ HR',
    diagnosticCode
  }, 502);
}

async function proxyRequest(fetcher, cfg, code, action, args, time) {
  const body = JSON.stringify({ code, action, args, time });
  let reply;
  try {
    reply = await fetcher(cfg.relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, mac: hmac(cfg.relaySecret, 'relay.v2\n' + body) }),
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000)
    });
  } catch (error) {
    throw new RelayRequestError(error?.name === 'TimeoutError' ? 'RELAY_TIMEOUT' : 'RELAY_NETWORK');
  }
  if ([401, 403].includes(reply.status) || reply.url.startsWith('https://accounts.google.com/')) {
    throw new RelayRequestError('RELAY_ACCESS', reply.status);
  }
  if (!reply.ok) throw new RelayRequestError('RELAY_HTTP', reply.status);
  if (!reply.headers.get('content-type')?.includes('application/json')) {
    throw new RelayRequestError('RELAY_NON_JSON', reply.status);
  }
  try {
    return await reply.json();
  } catch {
    throw new RelayRequestError('RELAY_BAD_REPLY', reply.status);
  }
}

async function parseRequest(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) return null;
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createHandler({ env = process.env, fetcher = fetch, clock = Date.now } = {}) {
  return async function handler(request) {
    let cfg;
    try {
      cfg = config(env);
    } catch {
      return response({ ok: false, error: 'ระบบ Netlify ยังตั้งค่าไม่ครบ กรุณาติดต่อ HR' }, 503);
    }
    const now = Math.floor(clock() / 1000);
    const session = readSession(request, cfg, now);
    if (request.method === 'GET') {
      return response({ok:true,data:{signedIn:Boolean(session),employeeCode:session?.code}});
    }
    if (request.method !== 'POST') return response({ ok: false, error: 'คำขอนี้ไม่รองรับ' }, 405, { Allow: 'GET, POST' });
    if (request.headers.get('origin') !== cfg.origin) return response({ ok: false, error: 'ต้นทางคำขอไม่ถูกต้อง' }, 403);
    const call = await parseRequest(request);
    if (!call || typeof call.action !== 'string') return response({ ok: false, error: 'คำขอไม่ถูกต้องหรือไฟล์ใหญ่เกินไป' }, 400);

    if (call.action === 'logout') return response({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });
    if (call.action==='employeeLogin') {
      const code=employeeCode(call.code);
      if (!code) {
        return response({ok:false,error:LOGIN_DENIED},401);
      }
      try {
        const result=await proxyRequest(fetcher,cfg,code,'employeeLogin',[],clock());
        if (result?.ok === false) {
          if (result.code === 'AUTH_DENIED') return response({ ok: false, error: LOGIN_DENIED }, 401);
          if (result.code === 'UNAUTHORIZED') return loginRelayUnavailable('RELAY_SIGNATURE');
          if (result.code === 'APP_ERROR') {
            return loginRelayUnavailable(LOGIN_SETUP_ERRORS.get(result.error) || 'RELAY_APP');
          }
        }
        if (result?.ok !== true || result.data?.code !== code) return loginRelayUnavailable('RELAY_BAD_REPLY');
        return response({ok:true},200,{'Set-Cookie':loginCookie(cfg,code,now+SESSION_LIMIT,now)});
      } catch (error) {
        if (error instanceof RelayRequestError) return loginRelayUnavailable(error.code, error.upstreamStatus);
        return loginRelayUnavailable('RELAY_UNEXPECTED');
      }
    }
    if (!session) return response({ ok: false, error: 'กรุณาเข้าสู่ระบบก่อน' }, 401);
    if (!ACTIONS.has(call.action) || !Array.isArray(call.args) || call.args.length > 2) {
      return response({ ok: false, error: 'ไม่พบคำสั่ง' }, 400);
    }
    if (call.action === 'stageEvidence') {
      const data = call.args[0]?.data;
      if (typeof data !== 'string' || data.length > 2_700_000) {
        return response({ ok: false, error: 'ไฟล์ภาพต้องมีขนาดไม่เกิน 2 MB' }, 413);
      }
    }
    try {
      const result = await proxyRequest(fetcher, cfg, session.code, call.action, call.args, clock());
      if (result.ok !== true) {
        if(result.code==='AUTH_DENIED') return response({ok:false,error:'กรุณาเข้าสู่ระบบอีกครั้ง'},401,{'Set-Cookie':sessionCookie()});
        if(result.code==='FORBIDDEN') return response({ok:false,error:'บัญชีนี้ไม่มีสิทธิ์ตรวจหลักฐาน'},403);
        return result.code === 'UNAUTHORIZED' ?
          response({ ok: false, error: 'การเชื่อมต่อกับระบบหลักฐานมีปัญหา กรุณาติดต่อ HR' }, 502) :
          response({ ok: false, error: result.error || 'ระบบจัดการรายการไม่สำเร็จ' }, 422);
      }
      return response({ ok: true, data: result.data });
    } catch {
      return response({ ok: false, error: 'ระบบเชื่อมต่อ Google Drive ไม่สำเร็จ กรุณาลองอีกครั้ง' }, 502);
    }
  };
}

export default createHandler();

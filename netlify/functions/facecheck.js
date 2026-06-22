// Face Hunt Serverless Function - v2.1 (Account Management API)
const crypto = require('crypto');

const SEARCH_API_BASE = 'https://facecheck.id';
const SEARCH_API = `${SEARCH_API_BASE}/api`;
const ACCOUNT_PRIORITY = ['Old Account', 'Account 2', 'Account 1', 'Account 5'];

// ─── Account Management ───

function getEnvAccounts() {
  try {
    const raw = process.env.FACECHECK_ACCOUNTS;
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) { 
    console.error('Failed to parse FACECHECK_ACCOUNTS:', e.message);
    return []; 
  }
}

// Client can pass accounts in the request body for dynamic management
function resolveAccounts(eventBody) {
  let accts = getEnvAccounts();
  
  // Check if client sent accounts
  let clientAccts = null;
  if (eventBody) {
    try {
      const parsed = typeof eventBody === 'string' ? JSON.parse(eventBody) : eventBody;
      if (parsed && parsed.__accounts) {
        clientAccts = parsed.__accounts;
      }
    } catch (e) { /* ignore parse errors */ }
  }
  
  // Merge: client accounts override env accounts
  if (clientAccts && Array.isArray(clientAccts) && clientAccts.length > 0) {
    // Replace any accounts with same name
    const merged = [...accts];
    for (const ca of clientAccts) {
      const idx = merged.findIndex(a => a.name === ca.name);
      if (idx >= 0) merged[idx] = ca;
      else merged.push(ca);
    }
    accts = merged;
  }
  
  return accts;
}

function getBestAccount(accts) {
  if (!accts || !accts.length) return null;
  
  const sorted = [...accts].sort((a, b) => {
    const pa = ACCOUNT_PRIORITY.indexOf(a.name);
    const pb = ACCOUNT_PRIORITY.indexOf(b.name);
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  });
  
  return sorted[0];
}

function getToken(accts) {
  const best = getBestAccount(accts);
  if (best && best.token) return best.token;
  
  // Fallback to env
  try {
    const envAccts = getEnvAccounts();
    const envBest = getBestAccount(envAccts);
    if (envBest && envBest.token) return envBest.token;
  } catch (e) {}
  
  return process.env.FACECHECK_TOKEN || '';
}

// ─── API Fetch ───

async function apiFetch(path, opts = {}) {
  const token = getToken(opts._accounts);
  const headers = { 
    Authorization: token, 
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
    Origin: 'https://facecheck.id',
    Referer: 'https://facecheck.id/'
  };
  
  const fetchOpts = { 
    method: opts.method || 'POST', 
    headers, 
    redirect: 'follow' 
  };
  
  if (opts.body) { 
    fetchOpts.body = opts.body; 
    if (opts.ct) headers['Content-Type'] = opts.ct; 
  }
  
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${SEARCH_API}${path}`, fetchOpts);
      const txt = await r.text();
      let data; 
      try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 500) }; }
      if (r.status === 429 && i < 4) { 
        await new Promise(x => setTimeout(x, 1000 * (i + 1))); 
        continue; 
      }
      if (!r.ok) data._proxy_error = `HTTP ${r.status}`;
      return { status: r.status, data };
    } catch (e) { 
      if (i >= 4) return { status: 502, data: { error: e.message } }; 
    }
  }
  return { status: 502, data: { error: 'Max retries' } };
}

// ─── Multipart Parsing ───

function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const files = {}, fields = {};
  let start = 0;
  while (start < buf.length) {
    const idx = buf.indexOf(delim, start);
    if (idx === -1) break;
    start = idx + delim.length;
    if (start + 2 <= buf.length && buf[start] === 0x2d && buf[start+1] === 0x2d) break;
    if (buf[start] === 0x0d && buf[start+1] === 0x0a) start += 2;
    const nextIdx = buf.indexOf(delim, start);
    const partEnd = nextIdx === -1 ? buf.length : nextIdx;
    const part = buf.slice(start, partEnd);
    let contentEnd = part.length;
    if (contentEnd >= 2 && part[contentEnd-2] === 0x0d && part[contentEnd-1] === 0x0a) contentEnd -= 2;
    const partData = part.slice(0, contentEnd);
    const sepIdx = partData.indexOf(Buffer.from('\r\n\r\n'));
    if (sepIdx === -1) continue;
    const hdr = partData.slice(0, sepIdx).toString('latin1');
    const body = partData.slice(sepIdx + 4);
    const nm = (hdr.match(/name="([^"]*)"/) || [])[1]; if (!nm) continue;
    const fn = (hdr.match(/filename="([^"]*)"/) || [])[1];
    const mime = (hdr.match(/Content-Type:\s*(\S+)/) || [])[1] || 'image/jpeg';
    if (fn) files[nm] = { filename: fn, data: body, mime };
    else fields[nm] = body.toString('utf-8');
    start = partEnd;
  }
  return { files, fields };
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 20) return token.slice(0, 10) + '...';
  return token.slice(0, 20) + '...';
}

// ─── Main Handler ───

exports.handler = async (event) => {
  const corsHeaders = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 
    'Access-Control-Allow-Headers': 'Content-Type' 
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const action = event.queryStringParameters?.action || 'status';
  
  try {
    // ═══ Status ═══
    if (action === 'status') {
      const envAccts = getEnvAccounts();
      const best = getBestAccount(envAccts);
      return { 
        statusCode: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'ok', 
          platform: 'netlify-serverless', 
          accounts: envAccts.length, 
          best_account: best?.name || 'none',
          version: '2.1' 
        }) 
      };
    }
    
    // ═══ List Accounts (with masked tokens) ═══
    if (action === 'accounts') {
      const accts = getEnvAccounts();
      const masked = accts.map(a => ({
        name: a.name,
        account_id: a.account_id || '',
        secret_id: a.secret_id || '',
        token_preview: maskToken(a.token),
        secrets: a.secrets || [],
        has_token: !!a.token
      }));
      return { 
        statusCode: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accounts: masked,
          total: masked.length,
          priority: ACCOUNT_PRIORITY
        }) 
      };
    }
    
    // ═══ Info ═══
    if (action === 'info') {
      // Parse event body for accounts
      let accounts = null;
      try {
        const body = JSON.parse(event.body || '{}');
        accounts = body.__accounts;
      } catch (e) {}
      const r = await apiFetch('/info', { body: '{}', ct: 'application/json', _accounts: accounts });
      return { 
        statusCode: r.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(r.data) 
      };
    }
    
    // ═══ Upload ═══
    if (action === 'upload') {
      const ct = event.headers['content-type'] || event.headers['Content-Type'] || '';
      const bm = ct.match(/boundary=(.+)/);
      if (!bm) return { 
        statusCode: 400, 
        headers: corsHeaders, 
        body: JSON.stringify({ error: 'No boundary in content-type' }) 
      };
      
      const boundary = bm[1].trim().replace(/^"|"$/g, '');
      const buf = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'latin1');
      const { files, fields } = parseMultipart(buf, boundary);
      
      if (!files.images) return { 
        statusCode: 400, 
        headers: corsHeaders, 
        body: JSON.stringify({ error: 'No images field in upload' }) 
      };
      
      // Check for client accounts in multipart fields
      let clientAccounts = null;
      if (fields.__accounts) {
        try { clientAccounts = JSON.parse(fields.__accounts); } catch (e) {}
      }
      
      // Rebuild multipart with fresh boundary
      const fb = '----FaceHunt' + crypto.randomBytes(16).toString('hex');
      let bodyParts = [];
      
      for (const [k, v] of Object.entries(fields)) {
        if (k === '__accounts') continue; // Skip our internal field
        bodyParts.push(Buffer.from(`--${fb}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      }
      
      bodyParts.push(Buffer.from(`--${fb}\r\nContent-Disposition: form-data; name="images"; filename="${files.images.filename}"\r\nContent-Type: ${files.images.mime}\r\n\r\n`));
      bodyParts.push(files.images.data);
      bodyParts.push(Buffer.from(`\r\n--${fb}--\r\n`));
      
      const body = Buffer.concat(bodyParts);
      const r = await apiFetch('/upload_pic', { 
        body, 
        ct: `multipart/form-data; boundary=${fb}`,
        _accounts: clientAccounts
      });
      return { 
        statusCode: r.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(r.data) 
      };
    }
    
    // ═══ Search ═══
    if (action === 'search') {
      // Parse client accounts from body
      let clientAccounts = null;
      let cleanBody = event.body || '{}';
      try {
        const parsed = JSON.parse(event.body || '{}');
        if (parsed.__accounts) {
          clientAccounts = parsed.__accounts;
          delete parsed.__accounts; // Remove before forwarding
          cleanBody = JSON.stringify(parsed);
        }
      } catch (e) {}
      
      const r = await apiFetch('/search', { 
        body: cleanBody, 
        ct: 'application/json',
        _accounts: clientAccounts
      });
      return { 
        statusCode: r.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(r.data) 
      };
    }
    
    return { 
      statusCode: 404, 
      headers: corsHeaders, 
      body: JSON.stringify({ error: 'Unknown action: ' + action }) 
    };
  } catch (e) {
    console.error('Function error:', e.message);
    return { 
      statusCode: 500, 
      headers: corsHeaders, 
      body: JSON.stringify({ error: e.message }) 
    };
  }
};

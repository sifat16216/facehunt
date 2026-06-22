// Face Hunt Serverless Function - v2.0 (Priority-based Token Rotation)
// Deployed on Netlify Edge Functions
const crypto = require('crypto');

const SEARCH_API_BASE = 'https://facecheck.id';
const SEARCH_API = `${SEARCH_API_BASE}/api`;
const ACCOUNT_PRIORITY = ['Account 2', 'Old Account', 'Account 1', 'Account 5'];

function getAccounts() {
  try {
    const raw = process.env.FACECHECK_ACCOUNTS;
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) { 
    console.error('Failed to parse FACECHECK_ACCOUNTS:', e.message);
    return []; 
  }
}

function getPriorityIndex(name) {
  for (let i = 0; i < ACCOUNT_PRIORITY.length; i++) {
    if (ACCOUNT_PRIORITY[i] === name) return i;
  }
  return -1;
}

function getToken() {
  const accts = getAccounts();
  if (!accts.length) return process.env.FACECHECK_TOKEN || '';
  
  // Sort by priority
  accts.sort((a, b) => {
    const pa = getPriorityIndex(a.name);
    const pb = getPriorityIndex(b.name);
    if (pa === -1 && pb === -1) return 0;
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  });
  
  // Use best account
  return accts[0]?.token || '';
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
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

function parseMultipart(buf, boundary) {
  const parts = buf.split(Buffer.from(`--${boundary}`));
  const files = {}, fields = {};
  for (const part of parts) {
    const idx = part.indexOf(Buffer.from('\r\n\r\n'));
    if (idx === -1) continue;
    const hdr = part.slice(0, idx).toString('latin1');
    let content = part.slice(idx + 4);
    if (content.length > 2 && content[content.length-2] === 0x0d && content[content.length-1] === 0x0a) content = content.slice(0, -2);
    const nm = (hdr.match(/name="([^"]*)"/) || [])[1]; if (!nm) continue;
    const fn = (hdr.match(/filename="([^"]*)"/) || [])[1];
    const mime = (hdr.match(/Content-Type:\s*(\S+)/) || [])[1] || 'image/jpeg';
    if (fn) files[nm] = { filename: fn, data: content, mime };
    else fields[nm] = content.toString('utf-8');
  }
  return { files, fields };
}

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
    if (action === 'status') {
      const accts = getAccounts();
      const tok = getToken();
      const bestName = accts.length > 0 ? accts[0]?.name : 'none';
      return { 
        statusCode: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'ok', 
          platform: 'netlify-serverless', 
          token_preview: tok ? tok.slice(0, 20) + '...' : 'none', 
          accounts: accts.length, 
          best_account: bestName,
          version: '2.0' 
        }) 
      };
    }
    
    if (action === 'info') {
      const r = await apiFetch('/info', { body: '{}', ct: 'application/json' });
      return { 
        statusCode: r.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(r.data) 
      };
    }
    
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
      
      // Rebuild multipart with fresh boundary
      const fb = '----FaceHunt' + crypto.randomBytes(16).toString('hex');
      let bodyParts = [];
      
      // Add text fields first
      for (const [k, v] of Object.entries(fields)) {
        bodyParts.push(Buffer.from(`--${fb}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      }
      
      // Add image file
      bodyParts.push(Buffer.from(`--${fb}\r\nContent-Disposition: form-data; name="images"; filename="${files.images.filename}"\r\nContent-Type: ${files.images.mime}\r\n\r\n`));
      bodyParts.push(files.images.data);
      bodyParts.push(Buffer.from(`\r\n--${fb}--\r\n`));
      
      const body = Buffer.concat(bodyParts);
      const r = await apiFetch('/upload_pic', { 
        body, 
        ct: `multipart/form-data; boundary=${fb}` 
      });
      return { 
        statusCode: r.status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        body: JSON.stringify(r.data) 
      };
    }
    
    if (action === 'search') {
      const r = await apiFetch('/search', { 
        body: event.body || '{}', 
        ct: 'application/json' 
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

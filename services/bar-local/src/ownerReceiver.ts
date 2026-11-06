import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readJson, readJsonWithText } from './http.js';
import { hashOwnerPassword, verifyOwnerPassword, dummyOwnerPasswordVerify, normalizeOwnerEmail, assertOwnerPassword } from './password.js';
import { digest, equalSignature, seal, sign, unseal } from './ownerCrypto.js';
import { createRateLimiter } from './rate-limit.js';
import type { Pool, PoolClient } from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
interface OwnerReceiverOptions {
    pool: Pool;
    masterKey: string;
    publicUrl: string;
    pwaOrigin: string;
    host?: string;
    port?: number;
    allowTestDatabase?: boolean;
    tls?: { certFile: string; keyFile: string };
    deliverVerification: (email: string, url: string) => Promise<void>;
}
class Refusal extends Error {
    status;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}
const id = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
        throw new Refusal(400, 'A valid identifier is required.');
    return value;
};
const keyIdentifier = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(value))
        throw new Refusal(400, 'A valid Bar connection identifier is required.');
    return value;
};
const text = (value: unknown, max = 240): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        throw new Refusal(400, 'The request has an invalid field.');
    return value.trim();
};
const token = () => randomBytes(32).toString('base64url');
const loopback = (host: string): boolean => ['127.0.0.1', 'localhost', '::1'].includes(host.replace(/^\[|\]$/g, ''));
export async function startOwnerReceiver(options: OwnerReceiverOptions) {
    const { pool } = options, host = options.host ?? '127.0.0.1';
    if (options.masterKey.length < 32)
        throw new Error('A protected receiver master key of at least 32 characters is required.');
    const publicUrl = new URL(options.publicUrl);
    const pwaOrigin = new URL(options.pwaOrigin).origin;
    if (!['https:', 'http:'].includes(new URL(options.pwaOrigin).protocol)
        || new URL(options.pwaOrigin).protocol !== 'https:' && !loopback(new URL(options.pwaOrigin).hostname)) {
        throw new Error('The owner receiver PWA origin must use HTTPS outside loopback.');
    }
    if ((!loopback(host) && !options.tls) || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || !['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.protocol !== 'https:' && !loopback(publicUrl.hostname))
        throw new Error('The owner receiver requires HTTPS outside loopback.');
    const db = (await pool.query("SELECT current_database() AS name, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='bar_local') AS trading")).rows[0];
    if (db.trading && !(options.allowTestDatabase && process.env.BAR_LOCAL_TEST_DB === '1' && db.name.startsWith('bar_local_test_')))
        throw new Error('The receiver must use a separate database from local Bar trading.');
    const limiter = createRateLimiter({ windowMs: 15 * 60000, max: 30 });
    const transaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const c = await pool.connect();
        try {
            await c.query('BEGIN');
            const result = await work(c);
            await c.query('COMMIT');
            return result;
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
    };
    async function account(req: IncomingMessage) {
        const raw = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
        const result = raw ? (await pool.query('SELECT a.id,a.email FROM bar_owner.sessions s JOIN bar_owner.accounts a ON a.id=s.owner_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.verified_at IS NOT NULL', [digest(raw)])).rows[0] : null;
        if (!result)
            throw new Refusal(401, 'Sign in to your verified owner account.');
        return result;
    }
    const handler = async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://local');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        try {
            const origin = req.headers.origin;
            if (origin && origin !== pwaOrigin)
                throw new Refusal(403, 'This application origin is not allowed.');
            if (origin === pwaOrigin) {
                res.setHeader('Access-Control-Allow-Origin', pwaOrigin);
                res.setHeader('Vary', 'Origin');
            }
            if (req.method === 'OPTIONS') {
                if (origin !== pwaOrigin)
                    throw new Refusal(403, 'This application origin is not allowed.');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Bar-Key-Id, X-Bar-Signature, X-Bar-Manifest-Hash, X-Bar-Batch-Id, X-Bar-Authority-Id');
                res.setHeader('Access-Control-Max-Age', '600');
                res.writeHead(204);
                res.end();
                return;
            }
            if (req.method === 'GET' && url.pathname === '/verify') {
                const verified = await transaction(async (c) => {
                    const row = (await c.query('UPDATE bar_owner.email_challenges SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING owner_id', [digest(text(url.searchParams.get('token'), 100))])).rows[0];
                    if (!row)
                        throw new Refusal(400, 'The verification link is invalid or expired. Register again to request a new link.');
                    await c.query('UPDATE bar_owner.accounts SET verified_at=COALESCE(verified_at,now()) WHERE id=$1', [row.owner_id]);
                    return true;
                });
                if (verified) {
                    res.writeHead(303, { location: pwaOrigin });
                    res.end();
                    return;
                }
            }
            if (req.method === 'POST' && ['/v1/register', '/v1/login'].includes(url.pathname)) {
                limiter.check(req.socket.remoteAddress ?? 'unknown');
                const body = await readJson(req, { limitBytes: 4096 });
                const email = normalizeOwnerEmail(body.email), password = assertOwnerPassword(body.password);
                const existing = (await pool.query('SELECT * FROM bar_owner.accounts WHERE email=$1', [email])).rows[0];
                if (url.pathname === '/v1/register') {
                    const verifier = await hashOwnerPassword(password);
                    const ownerId = existing?.id ?? randomUUID();
                    if (!existing)
                        await pool.query('INSERT INTO bar_owner.accounts(id,email,verifier) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING', [ownerId, email, verifier]);
                    if (!existing || !existing.verified_at && await verifyOwnerPassword(password, existing.verifier)) {
                        const raw = token();
                        await pool.query("INSERT INTO bar_owner.email_challenges(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(raw), ownerId]);
                        await options.deliverVerification(email, new URL('/verify?token=' + raw, publicUrl).href);
                    }
                    send(202, { ok: true, message: 'Check your email for verification, then sign in. Existing verified accounts can sign in now.' });
                    return;
                }
                if (!existing) {
                    await dummyOwnerPasswordVerify(password);
                    throw new Refusal(401, 'The owner email or password could not be verified.');
                }
                if (existing.locked_until && new Date(existing.locked_until).getTime() > Date.now())
                    throw new Refusal(429, 'Owner sign-in is temporarily locked. Try again in 15 minutes.');
                if (!await verifyOwnerPassword(password, existing.verifier)) {
                    await pool.query("UPDATE bar_owner.accounts SET failed_logins=CASE WHEN failed_logins>=4 THEN 0 ELSE failed_logins+1 END,locked_until=CASE WHEN failed_logins>=4 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1", [existing.id]);
                    throw new Refusal(401, 'The owner email or password could not be verified.');
                }
                if (!existing.verified_at)
                    throw new Refusal(403, 'Verify the owner email address before signing in.');
                const session = token();
                await pool.query("INSERT INTO bar_owner.sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '8 hours')", [digest(session), existing.id]);
                await pool.query('UPDATE bar_owner.accounts SET failed_logins=0,locked_until=NULL WHERE id=$1', [existing.id]);
                send(200, { ok: true, token: session, email });
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/links/claim') {
                limiter.check(req.socket.remoteAddress ?? 'unknown');
                const b = await readJson(req, { limitBytes: 8192 });
                const code = text(b.enrollment_code, 100), keyId = keyIdentifier(b.key_id), authority = id(b.authority_id), business = id(b.business_id), outlet = id(b.outlet_id), secret = text(b.secret, 128);
                if (secret.length < 32)
                    throw new Refusal(400, 'A protected sender secret is required.');
                const requestHash = digest(JSON.stringify([code, keyId, authority, business, outlet, secret, text(b.business_name)]));
                const result = await transaction(async (c) => {
                    const enrollment = (await c.query('SELECT * FROM bar_owner.enrollments WHERE code_hash=$1 FOR UPDATE', [digest(code)])).rows[0];
                    if (!enrollment)
                        throw new Refusal(403, 'The owner connection code is invalid or expired.');
                    const old = (await c.query('SELECT * FROM bar_owner.links WHERE key_id=$1', [keyId])).rows[0];
                    if (old) {
                        if (old.request_hash !== requestHash || enrollment.claimed_key_id !== keyId)
                            throw new Refusal(409, 'This connection attempt already has different details.');
                        return { ok: true, key_id: keyId, pending_approval: !old.active };
                    }
                    if (enrollment.claimed_key_id || new Date(enrollment.expires_at).getTime() <= Date.now())
                        throw new Refusal(403, 'The owner connection code is invalid or expired.');
                    await c.query('INSERT INTO bar_owner.links(key_id,owner_id,authority_id,business_id,outlet_id,business_name,secret_box,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [keyId, enrollment.owner_id, authority, business, outlet, text(b.business_name), seal(secret, options.masterKey), requestHash]);
                    await c.query('UPDATE bar_owner.enrollments SET claimed_key_id=$1 WHERE code_hash=$2', [keyId, digest(code)]);
                    await c.query("INSERT INTO bar_owner.audit(owner_id,action,details) VALUES($1,'link.claimed',$2)", [enrollment.owner_id, { key_id: keyId, authority_id: authority }]);
                    return { ok: true, key_id: keyId, pending_approval: true };
                });
                send(200, result);
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/links/status') {
                const b = await readJson(req, { limitBytes: 4096 }), keyId = keyIdentifier(b.key_id), nonce = text(b.nonce, 100);
                const link = (await pool.query('SELECT l.* FROM bar_owner.links l WHERE key_id=$1', [keyId])).rows[0];
                if (!link)
                    throw new Refusal(401, 'The owner link could not be authenticated.');
                const secret = unseal(link.secret_box, options.masterKey) as string;
                if (!equalSignature(text(b.signature, 128), sign(secret, { key_id: keyId, nonce })))
                    throw new Refusal(401, 'The owner link could not be authenticated.');
                const proof = { key_id: keyId, nonce, authority_id: link.authority_id, business_id: link.business_id, outlet_id: link.outlet_id, active: link.active && !link.revoked, revoked: link.revoked };
                send(200, { ...proof, signature: sign(secret, proof) });
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/cloud/batches') {
                const { value: b, rawText } = await readJsonWithText(req, { limitBytes: 16 * 1024 * 1024 }), keyId = keyIdentifier(req.headers['x-bar-key-id']);
                const result = await transaction(async (c) => {
                    const link = (await c.query('SELECT * FROM bar_owner.links WHERE key_id=$1 FOR SHARE', [keyId])).rows[0];
                    if (!link || !link.active || link.revoked)
                        throw new Refusal(403, 'The verified owner has not approved this Bar connection.');
                    const secret = unseal(link.secret_box, options.masterKey) as string;
                    const expected = createHmac('sha256', secret).update(`${keyId}.${b.batch_id}.${b.manifest_hash}`).digest('hex');
                    const signature = req.headers['x-bar-signature'];
                    if (!equalSignature(Array.isArray(signature) ? signature[0] : signature, expected) || req.headers['x-bar-manifest-hash'] !== b.manifest_hash || req.headers['x-bar-batch-id'] !== b.batch_id || req.headers['x-bar-authority-id'] !== b.authority_id || b.authority_id !== link.authority_id || b.business_id !== link.business_id || b.outlet_id !== link.outlet_id)
                        throw new Refusal(401, 'The signed batch identity or scope is invalid.');
                    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [link.authority_id]);
                    await c.query('SELECT cloud_ingest.receive($1::jsonb)', [rawText]);
                    await c.query('SELECT cloud_ingest.validate($1::jsonb)', [rawText]);
                    return (await c.query('SELECT cloud_ingest.ingest($1::jsonb) AS result', [rawText])).rows[0].result;
                });
                send(200, { ...result, received_at: new Date().toISOString() });
                return;
            }
            const owner = await account(req);
            if (req.method === 'POST' && url.pathname === '/v1/logout') {
                const authorization = req.headers.authorization;
                if (!authorization) throw new Refusal(401, 'Sign in to your verified owner account.');
                await pool.query('DELETE FROM bar_owner.sessions WHERE token_hash=$1', [digest(authorization.slice(7))]);
                send(200, { ok: true });
                return;
            }
            if (req.method === 'POST' && url.pathname === '/v1/owner/enrollment') {
                const code = 'bol_' + token();
                await pool.query("INSERT INTO bar_owner.enrollments(code_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [digest(code), owner.id]);
                send(201, { ok: true, enrollment_code: code, expires_in: 600 });
                return;
            }
            const manage = /^\/v1\/owner\/links\/([A-Za-z0-9._:-]{1,120})\/(approve|revoke)$/.exec(url.pathname);
            if (req.method === 'POST' && manage) {
                const keyId = keyIdentifier(manage[1]), active = manage[2] === 'approve';
                const changed = await pool.query('UPDATE bar_owner.links SET active=$1,revoked=NOT $1,approved_at=CASE WHEN $1 THEN now() ELSE approved_at END WHERE key_id=$2 AND owner_id=$3 AND (NOT revoked OR NOT $1) RETURNING key_id', [active, keyId, owner.id]);
                if (!changed.rowCount)
                    throw new Refusal(404, 'The Bar connection was not found or has been revoked.');
                await pool.query('INSERT INTO bar_owner.audit(owner_id,action,details) VALUES($1,$2,$3)', [owner.id, active ? 'link.approved' : 'link.revoked', { key_id: keyId }]);
                send(200, { ok: true });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/v1/owner/bars') {
                const rows = await pool.query('SELECT l.key_id,l.authority_id,l.business_id,l.business_name,l.active,l.revoked,l.created_at,w.last_ingested_at,w.ingested_events::text,w.max_ingested_sequence::text FROM bar_owner.links l LEFT JOIN cloud_ingest.watermarks w ON w.authority_id=l.authority_id WHERE l.owner_id=$1 ORDER BY l.created_at DESC', [owner.id]);
                send(200, { ok: true, email: owner.email, server_time: new Date().toISOString(), bars: rows.rows.map(row => ({ ...row, stale: !row.last_ingested_at || Date.now() - new Date(row.last_ingested_at).getTime() > 20 * 60000 })) });
                return;
            }
            const sales = /^\/v1\/owner\/bars\/([A-Za-z0-9._:-]{1,120})\/sales$/.exec(url.pathname);
            if (req.method === 'GET' && sales) {
                const keyId = keyIdentifier(sales[1]);
                const link = (await pool.query('SELECT authority_id,business_id,outlet_id,active,revoked FROM bar_owner.links WHERE key_id=$1 AND owner_id=$2', [keyId, owner.id])).rows[0];
                if (!link)
                    throw new Refusal(404, 'This Bar was not found.');
                if (!link.active || link.revoked)
                    throw new Refusal(403, 'This Bar connection is not active. Ask its owner to approve or reconnect it.');
                const from = url.searchParams.get('from'), to = url.searchParams.get('to');
                const datePattern = /^\d{4}-\d{2}-\d{2}$/;
                if (!from || !to || !datePattern.test(from) || !datePattern.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`)) || from > to)
                    throw new Refusal(400, 'Choose a valid date range.');
                const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
                if (days > 93)
                    throw new Refusal(400, 'Choose a period of 93 days or less.');
                const data = await pool.query(`
          WITH scoped AS (
            SELECT e.event_type,e.operation_id,e.commit_sequence,e.received_at,e.payload,
              e.business_date::text AS business_date,
              CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END AS receipt
            FROM cloud_ingest.events e
            WHERE e.authority_id=$1 AND e.business_id=$2 AND e.outlet_id=$3
              AND e.event_type IN ('sale.committed','sale.returned','sale.voided','sale.corrected_after_close')
              AND e.business_date BETWEEN $4::date AND $5::date
          ), valued AS (
            SELECT *,
              CASE WHEN receipt->>'total' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'total')::numeric ELSE 0 END AS amount,
              CASE WHEN receipt->>'tax' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'tax')::numeric ELSE 0 END AS tax_amount,
              CASE WHEN receipt->>'tip' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'tip')::numeric ELSE 0 END AS tip_amount,
              CASE WHEN receipt->>'total' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                AND receipt->>'tax' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                AND receipt->>'tip' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                AND COALESCE(receipt->>'sale_id','') <> ''
                THEN false ELSE true END AS invalid_projection
            FROM scoped
          ), totals AS (
            SELECT COALESCE(sum(amount) FILTER(WHERE event_type='sale.committed'),0)::text AS gross_sales,
              COALESCE(-sum(amount) FILTER(WHERE event_type='sale.returned'),0)::text AS returns,
              COALESCE(-sum(amount) FILTER(WHERE event_type='sale.voided'),0)::text AS voids,
              COALESCE(sum(amount) FILTER(WHERE event_type='sale.corrected_after_close'),0)::text AS other_corrections_signed,
              COALESCE(sum(amount),0)::text AS net_sales,
              count(*) FILTER(WHERE event_type='sale.committed')::integer AS committed_sales,
              COALESCE(sum(tax_amount) FILTER(WHERE event_type='sale.committed'),0)::text AS tax,
              COALESCE(sum(tip_amount) FILTER(WHERE event_type='sale.committed'),0)::text AS tips,
              count(*) FILTER(WHERE invalid_projection)::integer AS invalid_projection_rows
            FROM valued
          ), days AS (
            SELECT business_date,
              COALESCE(sum(amount) FILTER(WHERE event_type='sale.committed'),0)::text AS gross_sales,
              COALESCE(sum(amount) FILTER(WHERE event_type<>'sale.committed'),0)::text AS signed_adjustments,
              COALESCE(sum(amount),0)::text AS net_sales,
              count(*) FILTER(WHERE event_type='sale.committed')::integer AS committed_sales
            FROM valued GROUP BY business_date
          ), recent AS (
            SELECT event_type,operation_id,commit_sequence::text,business_date,
              receipt->>'sale_id' AS sale_id,receipt->>'receipt_number' AS receipt_number,
              receipt->>'receipt_series' AS receipt_series,receipt->>'status' AS status,
              receipt->>'subtotal' AS subtotal,receipt->>'discount' AS discount,
              receipt->>'tax' AS tax,receipt->>'tip' AS tip,receipt->>'total' AS total,
              receipt->>'original_sale_id' AS original_sale_id,
              CASE WHEN jsonb_typeof(receipt->'lines')='array' THEN jsonb_array_length(receipt->'lines') ELSE 0 END AS items_count,
              received_at
            FROM valued ORDER BY commit_sequence DESC LIMIT 50
          )
          SELECT (SELECT row_to_json(totals) FROM totals) AS totals,
            COALESCE((SELECT jsonb_agg(to_jsonb(days) ORDER BY business_date) FROM days),'[]'::jsonb) AS by_day,
            COALESCE((SELECT jsonb_agg(to_jsonb(recent) ORDER BY commit_sequence DESC) FROM recent),'[]'::jsonb) AS transactions,
            (SELECT last_ingested_at FROM cloud_ingest.watermarks WHERE authority_id=$1) AS last_ingested_at,
            (SELECT max_ingested_sequence::text FROM cloud_ingest.watermarks WHERE authority_id=$1) AS max_ingested_sequence
        `, [link.authority_id, link.business_id, link.outlet_id, from, to]);
                const row = data.rows[0];
                const complete = Number(row.totals.invalid_projection_rows) === 0;
                const { invalid_projection_rows: _invalidProjectionRows, ...totals } = row.totals;
                const receivedAt = new Date().toISOString();
                const stale = !row.last_ingested_at || Date.parse(receivedAt) - new Date(row.last_ingested_at).getTime() > 20 * 60_000;
                send(200, { ok: true, bar: { key_id: keyId, business_id: link.business_id, outlet_id: link.outlet_id }, period: { from, to }, complete, totals: complete ? totals : null, by_day: complete ? row.by_day : [], transactions: complete ? row.transactions : [], last_ingested_at: row.last_ingested_at, max_ingested_sequence: row.max_ingested_sequence, received_at: receivedAt, stale });
                return;
            }
            const operations = /^\/v1\/owner\/bars\/([A-Za-z0-9._:-]+)\/operations$/.exec(url.pathname);
            if (req.method === 'GET' && operations) {
                const keyId = keyIdentifier(operations[1]);
                const link = (await pool.query('SELECT authority_id,business_id,outlet_id,active,revoked FROM bar_owner.links WHERE key_id=$1 AND owner_id=$2', [keyId, owner.id])).rows[0];
                if (!link)
                    throw new Refusal(404, 'This Bar was not found.');
                if (!link.active || link.revoked)
                    throw new Refusal(403, 'This Bar connection is not active. Ask its owner to approve or reconnect it.');
                const from = url.searchParams.get('from'), to = url.searchParams.get('to');
                const datePattern = /^\d{4}-\d{2}-\d{2}$/;
                if (!from || !to || !datePattern.test(from) || !datePattern.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`)) || from > to)
                    throw new Refusal(400, 'Choose a valid date range.');
                const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
                if (days > 93)
                    throw new Refusal(400, 'Choose a period of 93 days or less.');
                const result = await pool.query(`
          WITH scoped AS (
            SELECT e.event_type,e.operation_id,e.commit_sequence,e.received_at,
              e.business_date::text AS business_date,
              CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END AS receipt,
              count(*) OVER()::integer AS period_event_count
            FROM cloud_ingest.events e
            WHERE e.authority_id=$1 AND e.business_id=$2 AND e.outlet_id=$3
              AND (e.event_type LIKE 'stock.%' OR e.event_type IN ('cashup.submitted','cashup.reviewed','cashup.reopened'))
              AND e.business_date BETWEEN $4::date AND $5::date
            ORDER BY e.commit_sequence DESC LIMIT 501
          ), selected AS (
            SELECT *,
              CASE WHEN receipt->>'delta' ~ '^-?[0-9]+([.][0-9]{1,6})?$' THEN (receipt->>'delta')::numeric END AS stock_delta,
              CASE WHEN receipt->>'quantity' ~ '^-?[0-9]+([.][0-9]{1,6})?$' THEN (receipt->>'quantity')::numeric END AS stock_quantity,
              CASE WHEN receipt->>'remaining_quantity' ~ '^-?[0-9]+([.][0-9]{1,6})?$' THEN (receipt->>'remaining_quantity')::numeric END AS remaining_quantity,
              CASE WHEN receipt->>'counted_cash' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'counted_cash')::numeric END AS counted_cash_value,
              CASE WHEN receipt->>'expected_cash' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'expected_cash')::numeric END AS expected_cash_value,
              CASE WHEN receipt->>'variance' ~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN (receipt->>'variance')::numeric END AS variance_value
            FROM scoped
          ), stock AS (
            SELECT event_type,operation_id,commit_sequence::text,business_date,
              receipt->>'product_id' AS product_id,receipt->>'sku' AS sku,
              trim_scale(stock_delta)::text AS delta,trim_scale(stock_quantity)::text AS quantity,
              trim_scale(remaining_quantity)::text AS remaining_quantity,received_at,
              stock_delta IS NULL OR COALESCE(receipt->>'product_id','') !~* '^[a-f0-9-]{36}$' AS invalid
            FROM selected WHERE event_type LIKE 'stock.%' AND event_type <> 'stock.lot.released'
          ), lot_events AS (
            SELECT event_type,operation_id,commit_sequence::text,business_date,
              receipt->>'product_id' AS product_id,receipt->>'lot_id' AS lot_id,
              receipt->>'reason' AS reason,receipt->>'status' AS status,received_at
            FROM selected WHERE event_type = 'stock.lot.released'
          ), cashups AS (
            SELECT selected.event_type,selected.operation_id,selected.commit_sequence::text,selected.business_date,
              selected.receipt->>'cashup_id' AS cashup_id,COALESCE(selected.receipt->>'shift_id',source.receipt->>'shift_id') AS shift_id,
              COALESCE(selected.counted_cash_value,source.counted_cash_value)::text AS counted_cash,
              COALESCE(selected.expected_cash_value,source.expected_cash_value)::text AS expected_cash,
              COALESCE(selected.variance_value,source.variance_value)::text AS variance,
              selected.receipt->>'status' AS status,selected.receipt->>'reviewed_by' AS reviewed_by,
              COALESCE(selected.receipt->>'submitted_by',source.receipt->>'submitted_by') AS submitted_by,selected.received_at,
              COALESCE(selected.counted_cash_value,source.counted_cash_value) IS NULL
                OR COALESCE(selected.expected_cash_value,source.expected_cash_value) IS NULL
                OR COALESCE(selected.variance_value,source.variance_value) IS NULL AS invalid
            FROM selected
            LEFT JOIN LATERAL (
              SELECT CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END AS receipt,
                CASE WHEN (CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'counted_cash' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                  THEN ((CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'counted_cash')::numeric END AS counted_cash_value,
                CASE WHEN (CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'expected_cash' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                  THEN ((CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'expected_cash')::numeric END AS expected_cash_value,
                CASE WHEN (CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'variance' ~ '^-?[0-9]+([.][0-9]{1,2})?$'
                  THEN ((CASE WHEN e.payload ? 'receipt' THEN e.payload->'receipt' ELSE e.payload END)->>'variance')::numeric END AS variance_value
              FROM cloud_ingest.events e
              WHERE e.authority_id=$1 AND e.business_id=$2 AND e.outlet_id=$3
                AND e.event_type IN ('cashup.submitted','cashup.reopened')
                AND e.commit_sequence < selected.commit_sequence
                AND e.payload #>> '{receipt,cashup_id}' = selected.receipt->>'cashup_id'
                OR e.authority_id=$1 AND e.business_id=$2 AND e.outlet_id=$3
                AND e.event_type IN ('cashup.submitted','cashup.reopened')
                AND e.commit_sequence < selected.commit_sequence
                AND e.payload->>'cashup_id' = selected.receipt->>'cashup_id'
              ORDER BY e.commit_sequence DESC LIMIT 1
            ) source ON selected.event_type = 'cashup.reviewed'
            WHERE selected.event_type IN ('cashup.submitted','cashup.reviewed','cashup.reopened')
          ), summary AS (
            SELECT count(*) FILTER(WHERE event_type LIKE 'stock.%' AND event_type <> 'stock.lot.released')::integer AS stock_movement_count,
              count(*) FILTER(WHERE event_type='cashup.submitted')::integer AS cashup_count,
              COALESCE(sum(variance_value) FILTER(WHERE event_type='cashup.submitted'),0)::text AS submitted_variance_total,
              ((SELECT count(*) FROM stock WHERE invalid)+(SELECT count(*) FROM cashups WHERE invalid))::integer AS invalid_rows
            FROM selected
          )
          SELECT (SELECT row_to_json(summary) FROM summary) AS summary,
            COALESCE((SELECT jsonb_agg(to_jsonb(stock) - 'invalid' ORDER BY commit_sequence DESC) FROM stock),'[]'::jsonb) AS stock_movements,
            COALESCE((SELECT jsonb_agg(to_jsonb(cashups) - 'invalid' ORDER BY commit_sequence DESC) FROM cashups),'[]'::jsonb) AS cashups,
            COALESCE((SELECT jsonb_agg(to_jsonb(lot_events) ORDER BY commit_sequence DESC) FROM lot_events),'[]'::jsonb) AS stock_lot_events,
            COALESCE((SELECT max(period_event_count) FROM selected),0)::integer AS period_event_count,
            (SELECT last_ingested_at FROM cloud_ingest.watermarks WHERE authority_id=$1) AS last_ingested_at,
            (SELECT max_ingested_sequence::text FROM cloud_ingest.watermarks WHERE authority_id=$1) AS max_ingested_sequence
        `, [link.authority_id, link.business_id, link.outlet_id, from, to]);
                const row = result.rows[0], truncated = row.period_event_count > 500, summary = row.summary;
                const complete = !truncated && Number(summary.invalid_rows) === 0;
                const receivedAt = new Date().toISOString();
                const stale = !row.last_ingested_at || Date.parse(receivedAt) - new Date(row.last_ingested_at).getTime() > 20 * 60_000;
                send(200, { ok: true, bar: { key_id: keyId, business_id: link.business_id, outlet_id: link.outlet_id }, period: { from, to }, complete, truncated, summary: complete ? { stock_movement_count: summary.stock_movement_count, cashup_count: summary.cashup_count, submitted_variance_total: summary.submitted_variance_total } : null, stock_movements: complete ? row.stock_movements : [], stock_lot_events: complete ? row.stock_lot_events : [], cashups: complete ? row.cashups : [], last_ingested_at: row.last_ingested_at, max_ingested_sequence: row.max_ingested_sequence, received_at: receivedAt, stale });
                return;
            }
            throw new Refusal(404, 'This operation is unavailable. The remote owner view cannot change Bar trading records.');
        }
        catch (error) {
            const e = error as Error & { status?: number; httpStatus?: number; code?: string };
            const status = e.status ?? e.httpStatus ?? (e.code === '23505' || e.code === 'BL001' ? 409 : 500);
            send(status, { ok: false, message: status >= 500 ? 'The owner service could not complete this request. Retry safely.' : e.message ?? 'Request refused.' });
        }
    };
    const listener = (req: IncomingMessage, res: ServerResponse) => { void handler(req, res); };
    const server = options.tls ? httpsServer({ cert: readFileSync(options.tls.certFile), key: readFileSync(options.tls.keyFile) }, listener) : httpServer(listener);
    server.requestTimeout = 30000;
    server.headersTimeout = 15000;
    server.maxHeadersCount = 50;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 8792, host, () => { server.off('error', reject); resolve(); }); });
    return { server, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

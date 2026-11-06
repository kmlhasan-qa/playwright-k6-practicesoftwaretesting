/**
 * k6 load test – Toolshop "booking" (order placement) API.
 *
 * Workload model: OPEN model (arrival-rate executors). New orders arrive at a fixed rate
 * regardless of how fast the system answers – like real customers – so slow responses
 * surface as latency / dropped iterations instead of silently lowering the load.
 *
 * One iteration = one customer order:
 *   POST /carts → POST /carts/{id} (add item) → POST /invoices  (the "booking" call)
 * The target rates (5/s normal, 20/s peak) apply to POST /invoices. Supporting calls add
 * ~2 more requests per order (total HTTP ≈ 3× the booking rate) – see README.
 *
 * Profiles (env PROFILE):
 *   smoke  (default) – 1 order/s, ~2 min. Safe to run against the public demo.
 *   load             – the full model: normal 5/s → ramp to 20/s → peak 20/s → recovery.
 *                      Run ONLY against an environment you own (see README "Limitations").
 *
 *   k6 run perf/checkout-load.js
 *   k6 run -e PROFILE=load -e API_URL=https://my-test-env perf/checkout-load.js
 */
import http from 'k6/http';
import { check, fail, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API_URL || 'https://api.practicesoftwaretesting.com';
const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();
const USER_POOL = Number(__ENV.USER_POOL || 10);
const TOKEN_TTL_MS = 240 * 1000; // API tokens expire after 300 s – refresh with margin.

// ---------- custom metrics ----------
const orderDuration = new Trend('order_flow_duration', true); // full 3-step order, end to end
const ordersCreated = new Counter('orders_created');
const orderSuccess = new Rate('order_success');

// ---------- workload ----------
const RATES = { normal: 5, peak: 20 };
const PROFILES = {
  smoke: { normal: 1, peak: 1, normalFor: '30s', rampFor: '30s', peakFor: '30s', recoveryFor: '30s', maxVUs: 10 },
  load: { normal: RATES.normal, peak: RATES.peak, normalFor: '5m', rampFor: '5m', peakFor: '5m', recoveryFor: '3m', maxVUs: 120 },
};
const p = PROFILES[PROFILE];
if (!p) throw new Error(`Unknown PROFILE "${PROFILE}" (use smoke | load)`);

const secs = (d) => (d.endsWith('m') ? parseInt(d, 10) * 60 : parseInt(d, 10));
const at = (...ds) => `${ds.reduce((s, d) => s + secs(d), 0)}s`;

// Rough VU sizing (Little's law): VUs ≈ rate × iteration time. With ~2 s per order at
// peak, 20/s needs ~40 VUs; preAllocate that and allow headroom up to maxVUs.
const vus = (rate) => ({ preAllocatedVUs: Math.max(2, Math.ceil(rate * 2)), maxVUs: p.maxVUs });

export const options = {
  scenarios: {
    normal: {
      executor: 'constant-arrival-rate',
      rate: p.normal, timeUnit: '1s', duration: p.normalFor,
      ...vus(p.normal), tags: { phase: 'normal' },
    },
    ramp_up: {
      executor: 'ramping-arrival-rate',
      startRate: p.normal, timeUnit: '1s',
      stages: [{ target: p.peak, duration: p.rampFor }],
      startTime: at(p.normalFor),
      ...vus(p.peak), tags: { phase: 'ramp_up' },
    },
    peak: {
      executor: 'constant-arrival-rate',
      rate: p.peak, timeUnit: '1s', duration: p.peakFor,
      startTime: at(p.normalFor, p.rampFor),
      ...vus(p.peak), tags: { phase: 'peak' },
    },
    recovery: {
      executor: 'constant-arrival-rate',
      rate: p.normal, timeUnit: '1s', duration: p.recoveryFor,
      startTime: at(p.normalFor, p.rampFor, p.peakFor),
      ...vus(p.normal), tags: { phase: 'recovery' },
    },
  },

  thresholds: {
    // Correctness first: almost every order must succeed, in every phase.
    'order_success': ['rate>0.99'],
    'checks': ['rate>0.99'],
    // Safety valve for a shared environment: stop early if things are clearly broken.
    'http_req_failed': [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' }],
    'http_req_failed{name:POST /invoices}': ['rate<0.01'],

    // Latency of the booking call, per phase. Baseline from smoke runs: p95 ≈ 0.75–0.85 s.
    'http_req_duration{name:POST /invoices,phase:normal}': ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{name:POST /invoices,phase:ramp_up}': ['p(95)<1500'],
    'http_req_duration{name:POST /invoices,phase:peak}': ['p(95)<1500', 'p(99)<3000'],
    'http_req_duration{name:POST /invoices,phase:recovery}': ['p(95)<1000'],
    // Supporting cart calls are simpler and should stay fast.
    'http_req_duration{flow:cart}': ['p(95)<800'],
    // Whole order as the customer experiences it.
    'order_flow_duration': ['p(95)<3000'],
    // The generator must actually deliver the planned rate, otherwise results are invalid.
    'dropped_iterations': ['count<10'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// ---------- setup: test users, a product and a valid billing address ----------
export function setup() {
  const run = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < USER_POOL; i++) {
    const user = {
      first_name: 'Perf', last_name: `User${i}`, email: `perf.${run}.${i}@example.com`,
      password: `Pf!${run}${i}Aa`, dob: '1990-05-15',
    };
    const res = http.post(`${API}/users/register`, JSON.stringify(user), { headers: JSON_HEADERS, tags: { name: 'setup' } });
    if (res.status !== 201) fail(`setup: register failed ${res.status} ${res.body}`);
    users.push({ email: user.email, password: user.password });
  }

  const list = http.get(`${API}/products?page=1`, { headers: JSON_HEADERS, tags: { name: 'setup' } }).json('data');
  const product = list.find((x) => x.in_stock && !x.is_rental && !x.is_location_offer);
  if (!product) fail('setup: no purchasable product');

  const a = http.get(`${API}/postcode-lookup?country=NL&postcode=3511AA&house_number=1`, { headers: JSON_HEADERS, tags: { name: 'setup' } }).json();
  const billing = {
    billing_street: `${a.street} ${a.house_number}`, billing_city: a.city, billing_state: a.state,
    billing_country: 'NL', billing_postal_code: '3511AA',
  };
  return { users, productId: product.id, price: product.price, billing };
}

// ---------- per-VU token cache (login once, refresh before expiry) ----------
let token = null;
let tokenAt = 0;
function authToken(users) {
  if (token && Date.now() - tokenAt < TOKEN_TTL_MS) return token;
  const u = users[(exec.vu.idInTest - 1) % users.length];
  const res = http.post(`${API}/users/login`, JSON.stringify(u), { headers: JSON_HEADERS, tags: { name: 'POST /users/login', flow: 'auth' } });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) return null;
  token = res.json('access_token');
  tokenAt = Date.now();
  return token;
}

// ---------- the order flow ----------
export default function (data) {
  const bearer = authToken(data.users);
  if (!bearer) { orderSuccess.add(false); return; }
  const started = Date.now();
  let ok = false;

  group('order', () => {
    const cart = http.post(`${API}/carts`, null, { headers: JSON_HEADERS, tags: { name: 'POST /carts', flow: 'cart' } });
    if (!check(cart, { 'cart created 201': (r) => r.status === 201 })) return;
    const cartId = cart.json('id');

    const add = http.post(`${API}/carts/${cartId}`, JSON.stringify({ product_id: data.productId, quantity: 1 }),
      { headers: JSON_HEADERS, tags: { name: 'POST /carts/{id}', flow: 'cart' } });
    if (!check(add, { 'item added 200': (r) => r.status === 200 })) return;

    const body = { ...data.billing, payment_method: 'cash-on-delivery', payment_details: {}, cart_id: cartId };
    const inv = http.post(`${API}/invoices`, JSON.stringify(body), {
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${bearer}` },
      tags: { name: 'POST /invoices', flow: 'booking' },
    });
    ok = check(inv, {
      'order created 201': (r) => r.status === 201,
      'invoice number issued': (r) => /^INV-\d+$/.test(r.json('invoice_number') || ''),
      'order total = price': (r) => Math.abs(Number(r.json('total')) - data.price) < 0.001,
    });
  });

  orderDuration.add(Date.now() - started);
  orderSuccess.add(ok);
  if (ok) ordersCreated.add(1);
}

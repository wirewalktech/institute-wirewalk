// Browser harness for the learner app: a static build of this site, served locally, with the
// learning Worker's API stubbed per test (page.route on site.api_base). No real network.
//
//   E2E_SITE=<dir>        a built site to serve (default: build this repo with Jekyll into a temp dir)
//   JEKYLL=<path>         the jekyll executable (default: "jekyll" on PATH)
//   PLAYWRIGHT=<path>     the playwright package (default: require("playwright"), see package.json)
//   E2E_CHROME=<path>     a Chromium executable (default: Playwright's own)
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "../..");
const API = (/^api_base:\s*(\S+)/m.exec(fs.readFileSync(path.join(REPO, "_config.yml"), "utf8")) || [])[1];
if (!API) throw new Error("api_base not found in _config.yml");

function playwright() {
  return require(process.env.PLAYWRIGHT || "playwright");
}

function buildSite() {
  if (process.env.E2E_SITE) return path.resolve(process.env.E2E_SITE);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "wia-e2e-site-"));
  execFileSync(process.env.JEKYLL || "jekyll", ["build", "-q", "-s", REPO, "-d", out], { stdio: "inherit" });
  return out;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain" };

function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end("not found"); }
      r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(r);
    }).listen(0, "127.0.0.1", () => resolve({ srv, origin: "http://localhost:" + srv.address().port }));
  });
}

/** A stand-in for Cloudflare Turnstile: renders nothing and always returns a token. */
const TURNSTILE_STUB = "window.turnstile={render:function(){return 1},getResponse:function(){return 'ts-ok'},reset:function(){}};";

/**
 * Stub the Worker. handler(method, pathname, body, url) returns a JSON body, or
 * {__status} for an error status, {__hang:true} to never answer, or undefined for a 404.
 * Every call is recorded in the returned array.
 */
async function stubApi(page, handler) {
  const calls = [];
  await page.route(API + "/**", async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    let body = null; try { body = req.postDataJSON(); } catch (e) { /* no body */ }
    calls.push({ m, p: u.pathname, body });
    let out = u.pathname === "/api/catalog" ? { courses: [], programs: [], tracks: [] } : await handler(m, u.pathname, body, u);
    if (out === undefined) out = { __status: 404, error: "not stubbed: " + m + " " + u.pathname };
    if (out && out.__hang) return;   // never answered: exercises the client's timeout
    const status = (out && out.__status) || 200;
    if (out && out.__status) { out = { ...out }; delete out.__status; }
    return route.fulfill({ status, contentType: "application/json", headers: cors(), body: JSON.stringify(out) });
  });
  await page.route("https://challenges.cloudflare.com/**", r => r.fulfill({ status: 200, contentType: "text/javascript", body: TURNSTILE_STUB }));
  return calls;
}
function cors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };
}

async function start() {
  const site = buildSite();
  const { srv, origin } = await serve(site);
  let browser;
  try { browser = await playwright().chromium.launch({ headless: true, executablePath: process.env.E2E_CHROME || undefined }); }
  catch (e) { srv.close(); throw e; }
  const errors = [];
  /** A fresh browser context. opts.token (default "tok"; false = signed out), opts.ls (localStorage), width. */
  async function newPage(width, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.addInitScript(o => {
      try {
        if (o.token !== false) localStorage.setItem("wia_token", o.token || "tok");
        for (const [k, v] of Object.entries(o.ls || {})) localStorage.setItem(k, v);
      } catch (e) { /* storage blocked */ }
    }, { token: opts.token, ls: opts.ls || {} });
    const page = await ctx.newPage();
    page.on("pageerror", e => errors.push(String(e)));
    return { ctx, page };
  }
  async function stop() { await browser.close(); srv.close(); }
  return { origin, newPage, stop, errors, API };
}

module.exports = { start, stubApi, API };

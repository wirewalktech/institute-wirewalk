#!/usr/bin/env node
// Mirror the Open Badges revocation status list from the learning Worker to
// badges/status/1.json, the permanent URL signed into every badge's credentialStatus
// (wirewalk-institute-worker ai/plans/open-badges-3.md section 14).
//
// Run by .github/workflows/badges-status.yml about every 10 minutes. No dependencies; Node 18+.
//
//   node .github/scripts/badges-status.mjs [--source <https URL | local file>] [--out <path>]
//
// The source defaults to {api_base}/api/ob3/status/1, with api_base read from _config.yml
// (the same Worker URL the site's pages call). --source with a local file is for tests only.
//
// Exit 0 and print changed=true|false (also to $GITHUB_OUTPUT). The file is written only when
// the list really changed (different bits, a different signing key, or no valid copy yet): the
// Worker re-signs the list with a new validFrom on every build, so byte equality would commit
// every run. Exit 1, writing nothing, when the fetched document is not a signed Wirewalk
// BitstringStatusListCredential, when its signing key is not published under badges/keys/, or
// when it would clear a bit that is set in the current copy (revocation is never reversed: an
// empty or wrong database behind the Worker must not un-revoke badges).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = "https://institute.wirewalk.com";
const LIST_ID = `${PUBLIC}/badges/status/1.json`;
const ISSUER_ID = `${PUBLIC}/badges/issuer.json`;
const VM = /^https:\/\/institute\.wirewalk\.com\/badges\/keys\/(key-[0-9]{1,3})\.json$/;
const LIST_BYTES = 16_384;   // 131,072 bits, the Bitstring Status List minimum
const MAX_BODY = 1_000_000;

function die(msg) { console.error(`badges-status: ${msg}. Nothing was written.`); process.exit(1); }

function args(argv) {
  const o = { source: null, out: join(ROOT, "badges/status/1.json") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") o.source = argv[++i];
    else if (argv[i] === "--out") o.out = resolve(argv[++i]);
    else die(`unknown option ${argv[i]}`);
  }
  return o;
}

function workerSource() {
  const cfg = readFileSync(join(ROOT, "_config.yml"), "utf8");
  const m = cfg.match(/^api_base:\s*["']?(https:\/\/[a-z0-9.-]+)\/?["']?\s*(#.*)?$/m);
  if (!m) die("_config.yml has no https api_base");
  return `${m[1]}/api/ob3/status/1`;
}

async function fetchText(source) {
  if (!/^https:\/\//.test(source)) return readFileSync(source, "utf8");   // tests only
  let res;
  try {
    res = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/vc+ld+json, application/json" } });
  } catch (e) { die(`could not fetch ${source}: ${e && e.message || e}`); }
  if (!res.ok) die(`${source} answered HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BODY) die(`${source} sent ${text.length} bytes`);
  return text;
}

const one = v => Array.isArray(v) ? (v.length === 1 ? v[0] : null) : v;
const has = (v, x) => (Array.isArray(v) ? v : [v]).includes(x);

function bits(encoded) {
  if (typeof encoded !== "string" || !/^u[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("encodedList is not base64url multibase (u...)");
  const raw = gunzipSync(Buffer.from(encoded.slice(1), "base64url"));
  if (raw.length !== LIST_BYTES) throw new Error(`encodedList decodes to ${raw.length} bytes, not ${LIST_BYTES}`);
  return raw;
}

/** Throws unless `doc` is our signed status list; returns {bits, kid}. */
function check(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("not a JSON object");
  if (!Array.isArray(doc["@context"]) || doc["@context"][0] !== "https://www.w3.org/ns/credentials/v2") throw new Error("@context does not start with credentials/v2");
  if (doc.id !== LIST_ID) throw new Error(`id is ${JSON.stringify(doc.id)}, not ${LIST_ID}`);
  if (!has(doc.type, "VerifiableCredential") || !has(doc.type, "BitstringStatusListCredential")) throw new Error("type is not a BitstringStatusListCredential");
  if ((doc.issuer && doc.issuer.id || doc.issuer) !== ISSUER_ID) throw new Error(`issuer is not ${ISSUER_ID}`);
  const s = doc.credentialSubject;
  if (!s || s.type !== "BitstringStatusList" || s.statusPurpose !== "revocation") throw new Error("credentialSubject is not a revocation BitstringStatusList");
  const p = one(doc.proof);
  if (!p || p.type !== "DataIntegrityProof" || p.cryptosuite !== "eddsa-rdfc-2022" || p.proofPurpose !== "assertionMethod"
      || typeof p.proofValue !== "string" || !/^z[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(p.proofValue)) throw new Error("no eddsa-rdfc-2022 assertionMethod proof");
  const m = VM.exec(String(p.verificationMethod || ""));
  if (!m) throw new Error(`proof key ${JSON.stringify(p.verificationMethod)} is not under ${PUBLIC}/badges/keys/`);
  if (/workers\.dev/.test(JSON.stringify(doc))) throw new Error("the document names a workers.dev URL");
  return { bits: bits(s.encodedList), kid: m[1], vm: p.verificationMethod };
}

function setOutput(changed) {
  console.log(`changed=${changed}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const source = o.source || workerSource();
  const text = await fetchText(source);
  let doc; try { doc = JSON.parse(text); } catch { die(`${source} did not send JSON`); }
  let next; try { next = check(doc); } catch (e) { die(`${source}: ${e.message}`); }

  // The signing key must already be published on this site, or verifiers could not check the list.
  const keyFile = join(ROOT, "badges/keys", `${next.kid}.json`);
  if (!existsSync(keyFile)) die(`the list is signed by ${next.kid}, but badges/keys/${next.kid}.json is not in this repository`);
  let keyDoc; try { keyDoc = JSON.parse(readFileSync(keyFile, "utf8")); } catch { die(`badges/keys/${next.kid}.json is not JSON`); }
  if (keyDoc.id !== next.vm || keyDoc.revoked) die(`badges/keys/${next.kid}.json is not the active key ${next.vm}`);

  let prev = null;
  if (existsSync(o.out)) { try { prev = check(JSON.parse(readFileSync(o.out, "utf8"))); } catch (e) { console.error(`badges-status: the current copy is not valid (${e.message}); replacing it`); } }
  if (prev) {
    let cleared = 0;
    for (let i = 0; i < LIST_BYTES; i++) { const lost = prev.bits[i] & ~next.bits[i]; for (let b = lost; b; b &= b - 1) cleared++; }
    if (cleared) die(`the new list would clear ${cleared} revoked bit(s); revocation is never reversed, so check the Worker's database`);
    if (Buffer.compare(prev.bits, next.bits) === 0 && prev.vm === next.vm) { setOutput(false); return; }
  }
  mkdirSync(dirname(o.out), { recursive: true });
  const tmp = `${o.out}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");   // formatting is not signed (RDF canonicalization)
  renameSync(tmp, o.out);
  setOutput(true);
}

main().catch(e => die(String(e && e.message || e)));

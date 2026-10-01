#!/usr/bin/env node
/**
 * Sync Venny's venue-intel knowledge blob from the canonical client
 * source into the Supabase edge-function copy.
 *
 * WHY THIS EXISTS
 *   Supabase Edge Functions run on Deno and bundle their own directory
 *   at deploy time — they CANNOT import from the app's Vite `src/` tree.
 *   (Same constraint that makes create-cover-payment inline its pricing
 *   algorithm; see that function's header comment.) So the Knoxville
 *   venue intel must physically exist in BOTH places:
 *
 *     - src/lib/vennyKnowledge.ts                   ← CANONICAL. Edit here.
 *     - supabase/functions/venny-chat/knowledge.ts  ← GENERATED. Do not
 *                                                     hand-edit the blob.
 *
 *   This script copies the KNOXVILLE_KNOWLEDGE template-literal CONTENT
 *   verbatim (byte-for-byte) from the canonical file into the edge copy,
 *   so the edge copy is a provably-regenerated artifact rather than a
 *   hand-maintained duplicate. The two wrapper functions legitimately
 *   diverge (client has getWelcomeMessage/getSuggestions + a CITIES-based
 *   fallback; edge is standalone Deno with its own CityKey) — only the
 *   shared data blob is synced.
 *
 * USAGE
 *   node scripts/sync-venny-knowledge.cjs           Write the edge copy.
 *   node scripts/sync-venny-knowledge.cjs --check   CI/pre-deploy: exit 1
 *                                                    if the edge copy has
 *                                                    drifted from canonical.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL = path.join(ROOT, 'src/lib/vennyKnowledge.ts');
const EDGE = path.join(ROOT, 'supabase/functions/venny-chat/knowledge.ts');

// The blob has no backticks inside it, so a non-greedy match up to the
// first closing "`;" cleanly captures the template-literal content.
const BLOB_RE = /const KNOXVILLE_KNOWLEDGE = `([\s\S]*?)`;/;

function extractBlob(text, label) {
  const m = text.match(BLOB_RE);
  if (!m) {
    console.error(`[sync-venny-knowledge] FATAL: KNOXVILLE_KNOWLEDGE blob not found in ${label}`);
    process.exit(2);
  }
  return m[1];
}

const checkOnly = process.argv.includes('--check');

const canonicalText = fs.readFileSync(CANONICAL, 'utf8');
const edgeText = fs.readFileSync(EDGE, 'utf8');

const canonicalBlob = extractBlob(canonicalText, 'src/lib/vennyKnowledge.ts');
const edgeBlob = extractBlob(edgeText, 'supabase/functions/venny-chat/knowledge.ts');

if (canonicalBlob === edgeBlob) {
  console.log('✓ venny knowledge blob in sync (edge === canonical)');
  process.exit(0);
}

if (checkOnly) {
  console.error('✗ DRIFT: edge knowledge blob differs from canonical source.');
  console.error('  Run: node scripts/sync-venny-knowledge.cjs');
  process.exit(1);
}

const nextEdgeText = edgeText.replace(
  BLOB_RE,
  'const KNOXVILLE_KNOWLEDGE = `' + canonicalBlob + '`;',
);
fs.writeFileSync(EDGE, nextEdgeText);
console.log('✓ synced edge knowledge blob from canonical src/lib/vennyKnowledge.ts');

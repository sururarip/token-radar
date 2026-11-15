// A working token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. Last, it writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. A starting
// point, not a winner: it covers the watchlist, states the model and gives every protocol a farm plan.
// Change the model, the page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, reasonsFor, riskBandOf, velocityOf } from './lib/model.ts';
import type { BoardRow, CategorySlice, RadarData, Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- summary output
//
// board.json is the whole ranking; summary.json is the one-page read of it. It carries the top
// ten with the reasons each one ranks where it does, the board grouped by category, and the
// totals, so a reader who never opens the 203-row board still sees what the radar found. It is
// written beside board.json and data.js, and the dossier never sees it: buildDossier reads only
// dashboard/ and screenshots/.

/** One row of the summary's top ten, with the reasons it ranks where it does. */
interface SummaryTopRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  implied_value_usd: number;
  tvl_usd: number;
  change_7d: number | null;
  velocity_score: number;
  velocity_label: string;
  risk_band: string;
  reasons: string[];
}

/** The summary: the top ten, the board by category, and the totals. */
interface BoardSummaryJson {
  as_of: string;
  model_version: string;
  board_size: number;
  watchlist_size: number;
  live_size: number;
  total_implied_usd: number;
  top10: SummaryTopRow[];
  categories: CategorySlice[];
}

/** The summary document from a built board and radar: the top ten with reasons, the category
 * slices, and the totals. The top row's velocity and risk are read off the row itself, and every
 * reason is the one reasonsFor derives from the whole board. */
function buildSummary(board: BoardRow[], radar: RadarData, snapshot: Snapshot): BoardSummaryJson {
  const top10 = board.slice(0, 10).map((row) => {
    const velocity = velocityOf(row);
    return {
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      implied_value_usd: row.implied_value_usd,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      velocity_score: velocity.score,
      velocity_label: velocity.label,
      risk_band: riskBandOf(row, row.age_days),
      reasons: reasonsFor(row, board),
    };
  });
  const total = board.reduce((n, r) => n + r.implied_value_usd, 0);
  return {
    as_of: snapshot.as_of,
    model_version: radar.model_version,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    live_size: radar.live_size,
    total_implied_usd: total,
    top10,
    categories: radar.categories,
  };
}

/** A last check before the run is declared done: every output the run owes is on disk, the board
 * and the summary agree on the top row and the row count, and the screenshots are the three the
 * gate wants. A null return is a clean run; a string names the first thing that is wrong. */
function verifyOutputs(out: string, board: BoardRow[], shots: string[]): string | null {
  for (const name of ['board.json', 'data.js', 'summary.json', 'dossier.json']) {
    if (!existsSync(join(out, name))) return `missing ${name} in ${out}`;
  }
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as BoardSummaryJson;
  if (summary.board_size !== board.length) return `summary.json counts ${summary.board_size} rows, board.json counts ${board.length}`;
  if (summary.top10.length === 0 || summary.top10[0]!.slug !== board[0]!.slug) return 'summary.json top row is not the board top row';
  if (summary.categories.length === 0) return 'summary.json carries no category slices';
  if (shots.length < 3) return `screenshots/ holds ${shots.length} images, need 3`;
  return null;
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(buildSummary(board, radar, snapshot), null, 2)}\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// The run is not done until its own outputs check out: a missing file or a summary that
// disagrees with the board is a broken run, and it is better to fail here than to hand one in.
const verifyIssue = verifyOutputs(out, board, shots);
if (verifyIssue !== null) {
  process.stderr.write(`token radar: output check failed: ${verifyIssue}\n`);
  process.exit(1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'summary.json')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);

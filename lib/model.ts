// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other genuine token-launch candidate: a pre-token protocol that is not a wrapped, staked or
// bridged product of a token that already trades, not a centralised exchange, and not a versioned
// pool of another protocol. The wrapped, staked and bridged products are set aside because their
// token already trades (WBTC is Bitcoin, a staked-ETH receipt is ETH); ranking them as launches
// would put a wrapped asset at the top of a launch board. A protocol is a launch candidate when
// its index entry records no token (no market cap, no CoinGecko id, no symbol) and its category is
// not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX. The live
// token protocols are kept apart and shown as the market's own values, never mixed into the
// ranked board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base       = tvl_usd x BASE_MULTIPLE
//   category   = the category's token value per TVL dollar (DEXes and derivatives capture fees
//                directly, so they carry more; bridges and staking are thin infrastructure)
//   chains     = 1 + CHAIN_WEIGHT x (chains - 1), capped at CHAIN_CAP (reach across chains)
//   growth     = clamp(change_7d, -70, 200) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = the launch window: 0.55 at listing, rising to 1.00 over the first 18 months,
//                holding to 2 years, then easing to 0.85 by 3 years for protocols that have
//                waited longest without issuing a token
//   implied    = max(1, round(base x category x chains x growthMult x maturity))
//
// The constants are the model's, stated in the dashboard and changeable in the model sandbox. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.9,
  growth_floor: -70,
  growth_cap: 200,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.04,
  chain_cap: 1.4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiplier: number;
    chains_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiplier: number;
  chains_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  velocity_score: number;
  velocity_label: string;
  risk_band: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategorySlice[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category's token value per TVL dollar, first match wins on the lowercased category.
 * DEXes and derivatives capture trading fees directly, so a dollar of their TVL supports more
 * token value; bridges and staking are thin infrastructure, so a dollar of theirs supports less.
 * A category no rule names takes 1.00.
 */
const CATEGORY_MULT: Array<[string, number]> = [
  ['dex', 1.25],
  ['derivative', 1.25],
  ['perpetual', 1.25],
  ['rwa', 1.1],
  ['curator', 1.05],
  ['allocator', 1.05],
  ['liquid staking', 0.7],
  ['liquid restaking', 0.7],
  ['restak', 0.75],
  ['bridge', 0.6],
  ['staking', 0.7],
  ['stable', 0.9],
  ['insurance', 0.9],
];

export function categoryMultiplier(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  for (const [key, mult] of CATEGORY_MULT) {
    if (c.includes(key)) return mult;
  }
  return 1.0;
}

/** Reach across chains: each chain past the first adds a little, capped, because a protocol on
 * more chains reaches more users and more liquidity. */
export function chainsMultiplier(chains: string[], model: ModelConstants): number {
  const n = Math.max(0, chains.length - 1);
  return Math.min(1 + model.chain_weight * n, model.chain_cap);
}

/**
 * The launch window: a protocol's token is most valuable once it has proven itself but before it
 * has waited so long that the market doubts it will ever issue one. The multiplier rises from the
 * floor at listing to full value over the first 18 months, holds to 2 years, then eases 15% by
 * 3 years. An unknown age takes the 1-year point.
 */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const a = age ?? model.unknown_age_days;
  if (a <= 0) return model.maturity_floor;
  if (a < 540) return model.maturity_floor + (a / 540) * model.maturity_range;
  if (a <= 730) return model.maturity_floor + model.maturity_range;
  const over = Math.min(a - 730, 365);
  return model.maturity_floor + model.maturity_range - 0.15 * (over / 365);
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; categoryMult: number; chainsMult: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const categoryMult = categoryMultiplier(protocol.category);
  const chainsMult = chainsMultiplier(protocol.chains, model);
  const maturityMult = maturityMultiplier(age, model);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * categoryMult * chainsMult * growthMult * maturityMult));
  return { implied, categoryMult, chainsMult, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist's own rule leaves out: a wrapped, staked or bridged product of a
 * token that already trades, or a centralised exchange. Their token already exists in another
 * form, so they are not launches waiting to happen. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a genuine token-launch candidate: pre-token, not a wrapped, staked or
 * bridged product, not an exchange, not a versioned pool. The watchlist's own rule is the guide:
 * the same categories it leaves out are left out here, so the board ranks launches, not wrappers.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !WRAPPED_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other genuine launch candidate, above or below the watchlist floor.
  // The floor is never the ceiling, so a launch candidate above it is ranked too: the starter
  // missed the largest ones by stopping at the floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, categoryMult, chainsMult, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, categoryMult, chainsMult, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      category_multiplier: round4(s.categoryMult),
      chains_multiplier: round4(s.chainsMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain a protocol names, or null when it runs on one chain only. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action that deepens the footprint, so the wallet is not a one-trick deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${half} against the supplied collateral, hold it a week, then repay half of it.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${half} through ${name}'s pool on ${chain} and add a second, smaller liquidity position.`;
  if (c.includes('bridge')) return `Bridge $${half} back to the origin chain so the wallet shows a round trip.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate $${half} more to a different validator or pool through ${name}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first hedge and open a fresh one in the opposite direction.`;
  if (c.includes('prediction')) return `Settle the first position and place a second one on a different market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${half} into a second ${name} vault with a different risk profile.`;
  if (c.includes('stable')) return `Mint $${half} more of the stable asset and redeem half of it a week later.`;
  if (c.includes('rwa')) return `Mint $${half} more of the yield asset and hold it beside the first mint.`;
  if (c.includes('insurance')) return `Buy $${half} of cover for a second, different risk on ${chain}.`;
  return `Make a second, smaller deposit of $${half} into a different pool or vault on ${chain}.`;
}

/** A closing review step, worded for the position's risk: a hot, fast-moving protocol gets a
 * prompt to bank some of the position if the move reverses, while a calm one gets a prompt to
 * leave it alone and let the snapshots accumulate. */
function reviewStep(risk: RiskBand): FarmStep {
  if (risk === 'Elevated') {
    return {
      text: `Review the position every week while the move is hot, and take some of it off the table if the growth reverses sharply.`,
      cost: 'about $3 of gas to unwind part of the position',
      time: '10 minutes a week',
    };
  }
  return {
    text: `Review the position once a month, check the protocol's points page, and leave the position alone between reviews.`,
    cost: 'nothing to review',
    time: '10 minutes a month',
  };
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every step names what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const risk = riskBandOf(p, age);
  const action = actionFor(p, capital, chain);
  const secondAction = secondActionFor(p, capital, chain);
  const spreadStep: FarmStep =
    second !== null
      ? {
          text: `Repeat the same deposit on ${second} so the wallet's activity is counted on two chains, not one.`,
          cost: `another $${capital} of capital and about $4 of gas`,
          time: '15 minutes',
        }
      : {
          text: `Vote on one open governance proposal, or verify the wallet in the protocol's community forum.`,
          cost: 'about $1 of gas, or nothing to verify',
          time: '10 minutes',
        };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction,
      cost: `about $${Math.max(10, Math.round(capital / 2))} of capital and about $3 of gas`,
      time: '10 minutes',
    },
    spreadStep,
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    reviewStep(risk),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiplier: row.model.category_multiplier,
    chains_multiplier: row.model.chains_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    velocity_score: velocityOf(row).score,
    velocity_label: velocityOf(row).label,
    risk_band: riskBandOf(row, row.age_days),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    categories: categoryBreakdown(board, snapshot.watchlist),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// ---------------------------------------------------------------- velocity and risk
//
// The implied value ranks the board; it says nothing about direction. A protocol whose TVL is
// shrinking is a different bet from one whose TVL is growing, even when their implied values
// match, and a protocol that tripled in a week on a handful of deposits is a different bet from
// one that grew a tenth on a billion dollars of fresh money. So the model also reads momentum and
// risk off the same snapshot figures, as a second opinion the dashboard shows beside the ranking.
// Neither number moves the ranking: the board stays one function of TVL, category, chains, growth
// and age, and the velocity and risk readings sit next to it for a reader who wants the direction
// as well as the level.

/** A protocol's momentum, read off the snapshot alone. */
export interface Velocity {
  /** The momentum score, 0 to 100. */
  score: number;
  /** The score in words: Cooling, Steady, Heating or Surging. */
  label: string;
  /** The seven-day move the score read, or null when the snapshot carries none. */
  weeklyChange: number | null;
  /** The size tier the move sits in, 0 for the smallest pools, 3 for the largest. */
  sizeTier: number;
}

/** The size tier a TVL sits in: a move on a large pool moves more money than the same move on a
 * small one, so the tier is part of the momentum score. */
export function sizeTierOf(tvl: number): number {
  if (tvl >= 1_000_000_000) return 3;
  if (tvl >= 100_000_000) return 2;
  if (tvl >= 10_000_000) return 1;
  return 0;
}

/** A momentum score in words: the bands the dashboard prints beside the number. */
export function velocityLabel(score: number): string {
  if (score >= 75) return 'Surging';
  if (score >= 50) return 'Heating';
  if (score >= 25) return 'Steady';
  return 'Cooling';
}

/**
 * A protocol's momentum score, 0 to 100. The move itself is worth up to 70 points: the seven-day
 * change, clamped to -50..+100, stretched so a flat week scores near the middle and a strong rise
 * scores near the top. The pool's size is worth up to 30: each tier adds ten, because the same
 * percentage move on a larger pool is more money moving. A protocol with no recorded change takes
 * the middle of the move scale, and a protocol with no TVL takes the smallest tier.
 */
export function velocityOf(p: { change_7d: number | null; tvl_usd: number }): Velocity {
  const weekly = p.change_7d === null || !Number.isFinite(p.change_7d) ? null : p.change_7d;
  const tier = sizeTierOf(p.tvl_usd);
  const move = weekly === null ? 0 : Math.min(100, Math.max(-50, weekly));
  const movePoints = ((move + 50) / 150) * 70;
  const sizePoints = tier * 10;
  const score = Math.max(0, Math.min(100, Math.round(movePoints + sizePoints)));
  return { score, label: velocityLabel(score), weeklyChange: weekly, sizeTier: tier };
}

/** How exposed a farm position is, in three bands. */
export type RiskBand = 'Lower' | 'Moderate' | 'Elevated';

/**
 * A protocol's risk band, from the same figures. A wild week cuts both ways: a rise past 50% in
 * seven days, or a fall past 30%, is a spike that may not last, so either one is Elevated. A
 * protocol listed under 90 days ago is unproven, so it is Elevated too, and one that has waited
 * over two years with no token is Elevated because the wait itself is the doubt. A move between
 * -30% and +50% on a protocol between three months and two years old is Moderate, and a gentle
 * move on a protocol in that same age window is Lower. The band is a warning, not a verdict.
 */
export function riskBandOf(p: { change_7d: number | null }, age: number | null): RiskBand {
  const weekly = p.change_7d === null || !Number.isFinite(p.change_7d) ? 0 : p.change_7d;
  if (weekly > 50 || weekly < -30) return 'Elevated';
  if (age !== null && age < 90) return 'Elevated';
  if (age !== null && age > 730) return 'Elevated';
  if (weekly > 20 || weekly < -10) return 'Moderate';
  if (age !== null && age < 180) return 'Moderate';
  return 'Lower';
}

// ---------------------------------------------------------------- category breakdown
//
// The board is one long list, but the money is not spread evenly: a few categories hold most of
// the implied value, and a reader who only sees the list cannot tell whether the top is one
// category's story or many. The breakdown groups the board by category, counts the rows, adds the
// implied value, and names the strongest protocol in each group, so the shape of the whole launch
// set is visible at a glance.

/** One category's slice of the board. */
export interface CategorySlice {
  /** The category's name, or 'Other' when the snapshot names none. */
  category: string;
  /** How many board rows carry this category. */
  rows: number;
  /** How many of those rows came from the watchlist. */
  watchlistRows: number;
  /** The category's implied value, summed across its rows. */
  totalImplied: number;
  /** The category's share of the board's whole implied value, in per cent. */
  sharePct: number;
  /** The slug of the category's strongest row. */
  topSlug: string;
  /** The name of the category's strongest row. */
  topName: string;
  /** The strongest row's implied value. */
  topImplied: number;
}

/**
 * The board grouped by category, strongest total first. A category with no name on any row is
 * grouped under 'Other'. The share is each slice's part of the board's whole implied value, so
 * the slices always add to one hundred. A slice's top row is the one with the largest implied
 * value in that slice, which is also the first of its rows in board order.
 */
export function categoryBreakdown(board: BoardRow[], watchlist: string[]): CategorySlice[] {
  const watched = new Set(watchlist);
  const grand = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const groups = new Map<string, BoardRow[]>();
  for (const row of board) {
    const key = row.category === null || row.category === '' ? 'Other' : row.category;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [row]);
    else list.push(row);
  }
  const slices: CategorySlice[] = [];
  for (const [category, list] of groups) {
    const total = list.reduce((n, r) => n + r.implied_value_usd, 0);
    const top = list[0]!;
    slices.push({
      category,
      rows: list.length,
      watchlistRows: list.filter((r) => watched.has(r.slug)).length,
      totalImplied: total,
      sharePct: grand > 0 ? Math.round((total / grand) * 1000) / 10 : 0,
      topSlug: top.slug,
      topName: top.name,
      topImplied: top.implied_value_usd,
    });
  }
  slices.sort((a, b) => b.totalImplied - a.totalImplied || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return slices;
}

// ---------------------------------------------------------------- ranking reasons
//
// A rank without a reason is a number to take on trust. The reasons say, in plain words, why a
// row sits where it does: whether it is the largest pool, the fastest mover, the longest wait, the
// strongest in its category, or simply one of the strongest handful on the whole board. Every
// reason is checked against the board itself, so no row claims a superlative it does not hold.

/**
 * Two or three plain-word reasons a row ranks where it does. The first is always the row's own
 * standing: its rank in words. The rest are superlatives the row actually holds on this board:
 * the largest TVL, the fastest seven-day growth, the longest wait with no token, or the strongest
 * row in its category. A row that holds none of those still gets its rank and its category's
 * multiplier, so every row has something true said about it.
 */
export function reasonsFor(row: BoardRow, board: BoardRow[]): string[] {
  const reasons: string[] = [];
  if (row.rank === 1) reasons.push('The strongest implied value on the whole board.');
  else if (row.rank <= 3) reasons.push(`One of the three strongest implied values on the whole board, at rank ${row.rank}.`);
  else if (row.rank <= 10) reasons.push(`Inside the top ten, at rank ${row.rank} of ${board.length}.`);
  else reasons.push(`Ranked ${row.rank} of ${board.length} by implied value.`);
  const biggest = board.reduce((best, r) => (r.tvl_usd > best.tvl_usd ? r : best), board[0]!);
  if (biggest.slug === row.slug) reasons.push('The largest TVL of any pre-token protocol on the board.');
  const fastest = board.reduce((best, r) => ((r.change_7d ?? -Infinity) > (best.change_7d ?? -Infinity) ? r : best), board[0]!);
  if (fastest.slug === row.slug && (row.change_7d ?? 0) > 0) reasons.push('The fastest seven-day growth of any row on the board.');
  const oldest = board.reduce((best, r) => ((r.age_days ?? -1) > (best.age_days ?? -1) ? r : best), board[0]!);
  if (oldest.slug === row.slug && (row.age_days ?? 0) > 0) reasons.push(`The longest-running pre-token protocol here, waiting ${row.age_days} days with no token.`);
  const sameKind = board.filter((r) => (r.category ?? 'Other') === (row.category ?? 'Other'));
  if (sameKind.length > 0 && sameKind[0]!.slug === row.slug) {
    reasons.push(`The strongest implied value in its category, ${row.category ?? 'Other'}.`);
  }
  if (reasons.length < 2) {
    reasons.push(`Its category carries a ${row.model.category_multiplier}x multiplier on each TVL dollar.`);
  }
  return reasons.slice(0, 3);
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

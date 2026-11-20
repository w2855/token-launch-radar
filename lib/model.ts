// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value is a comparable-company estimate drawn from the snapshot's own figures:
//
//   compMult   = the median mcap/tvl of live-token protocols in the same valuation group
//                (a group with too few or too scattered samples falls back to the global median)
//   momentum   = 1 + clamp(change_7d, MOMENTUM_FLOOR, MOMENTUM_CAP) / 100 x MOMENTUM_WEIGHT
//   implied    = max(1, round(tvl_usd x compMult x momentum))
//
// Each row also carries a comparable band (the group's 25th and 75th percentile multiple applied to
// the same TVL), a confidence label that says how much data stands behind the number, a farm priority
// derived from TVL and age, and a farm plan generated from the protocol's own record. No protocol name
// is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  group_min_samples: number;
  group_max_spread: number;
  dead_ratio_floor: number;
  fallback_median: number;
  fallback_p25: number;
  fallback_p75: number;
}

export const MODEL: ModelConstants = {
  momentum_weight: 0.25,
  momentum_floor: -60,
  momentum_cap: 120,
  group_min_samples: 5,
  group_max_spread: 30,
  dead_ratio_floor: 0.005,
  fallback_median: 0.169,
  fallback_p25: 0.032,
  fallback_p75: 1.001,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many live-token peers the detail view shows as the comparable's evidence. */
export const PEER_ROWS = 4;

/** DefiLlama's categories folded into valuation groups: products a token would price the same way. */
const GROUPS: Record<string, string[]> = {
  lending: ['Lending', 'CDP', 'Collateral Markets', 'Collateralized Debt'],
  yield: ['Yield', 'Yield Aggregator', 'Leveraged Farming'],
  staking: ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Staking'],
  dex: ['Dexs', 'AMM', 'Liquidity Manager'],
  bridge: ['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Interchain Bridge'],
  rwa: ['RWA', 'Real World Assets', 'Private Credit', 'Tokenized Private Credit'],
  basis: ['Basis Trading', 'Delta Neutral'],
  cex: ['CEX', 'CeDeFi'],
  curator: ['Onchain Capital Allocator', 'Risk Curators', 'Vault', 'Asset Manager'],
  infra: ['Chain', 'Infrastructure', 'Validator', 'Node Operator'],
  payments: ['Payments', 'Payments Infrastructure'],
  insurance: ['Insurance', 'Prediction Market'],
};

/** The category to its valuation group, or null when no group fits it. */
export function valuationGroup(category: string | null): string | null {
  if (category === null) return null;
  for (const [group, list] of Object.entries(GROUPS)) if (list.includes(category)) return group;
  return null;
}

/** One valuation group's comparable statistics, as computed from the live-token protocols. */
export interface GroupStats {
  group: string;
  n: number;
  p25: number;
  median: number;
  p75: number;
  used: boolean;
  why: string;
}

/** The live-token protocol shown as a comparable's evidence. */
export interface PeerRow {
  name: string;
  category: string | null;
  mcap_usd: number;
  tvl_usd: number;
  ratio: number;
}

/** The snapshot's comparable table: every group's stats plus the global fallback. */
export interface Comparables {
  global: { n: number; p25: number; median: number; p75: number };
  groups: GroupStats[];
}

function sorted(a: number[]): number[] {
  return a.slice().sort((x, y) => x - y);
}

function pick(sortedArray: number[], fraction: number): number {
  return sortedArray[Math.min(sortedArray.length - 1, Math.floor(sortedArray.length * fraction))]!;
}

/** The comparable table: each group's live-token mcap/tvl distribution, and when the group's own
 *  figures are too thin or too scattered to price by, the global median stands in. Listings whose
 *  market cap is under a fraction of a per cent of TVL are excluded from every set: a deader-than-dead
 *  listing prices nothing, and keeping it would drag every median down. */
export function comparables(snapshot: Snapshot): Comparables {
  const liveAll = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const live = liveAll.filter((p) => (p.mcap_usd as number) / p.tvl_usd >= MODEL.dead_ratio_floor);
  const dead = liveAll.length - live.length;
  const globalRatios = sorted(live.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const global = { n: globalRatios.length, p25: pick(globalRatios, 0.25), median: pick(globalRatios, 0.5), p75: pick(globalRatios, 0.75) };
  const byGroup = new Map<string, number[]>();
  for (const p of live) {
    const g = valuationGroup(p.category);
    if (g === null) continue;
    const list = byGroup.get(g) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byGroup.set(g, list);
  }
  const groups: GroupStats[] = [];
  for (const group of Object.keys(GROUPS)) {
    const ratios = sorted(byGroup.get(group) ?? []);
    if (ratios.length === 0) continue;
    const p25 = pick(ratios, 0.25);
    const p75 = pick(ratios, 0.75);
    const spread = p25 > 0.001 ? p75 / p25 : Infinity;
    const used = ratios.length >= MODEL.group_min_samples && spread <= MODEL.group_max_spread;
    groups.push({
      group,
      n: ratios.length,
      p25,
      median: pick(ratios, 0.5),
      p75,
      used,
      why: used
        ? `${ratios.length} live-token comparables`
        : ratios.length < MODEL.group_min_samples
          ? `only ${ratios.length} live-token comparables, so the global median stands in`
          : `ratios span ${round2(spread)}x across ${ratios.length} comparables, so the global median stands in`,
    });
  }
  return { global, groups };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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
  band: { low_value_usd: number; high_value_usd: number };
  confidence: 'high' | 'medium' | 'low';
  comparable: { group: string; n: number; median: number; p25: number; p75: number; quality: 'class' | 'global' };
  farm_priority: 'first' | 'strong' | 'watch';
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
  band: { low_value_usd: number; high_value_usd: number };
  confidence: 'high' | 'medium' | 'low';
  comparable: { group: string; n: number; median: number; p25: number; p75: number; quality: 'class' | 'global' };
  farm_priority: 'first' | 'strong' | 'watch';
  in_watchlist: boolean;
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

/** Everything the dashboard needs: the board, the live set, the comparable table and the model. */
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
  comparables: Comparables;
  peer_table: Record<string, PeerRow[]>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The momentum multiplier, the comparable multiple and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  table: Comparables,
  model: ModelConstants = MODEL,
): { implied: number; momentum: number; compMedian: number; compP25: number; compP75: number; quality: 'class' | 'global'; group: string; groupN: number; why: string } {
  const rawGrowth = protocol.change_7d === null ? 0 : protocol.change_7d;
  const growthPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawGrowth));
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const group = valuationGroup(protocol.category);
  const stats = group === null ? undefined : table.groups.find((g) => g.group === group && g.used);
  const compMedian = stats ? stats.median : table.global.median;
  const compP25 = stats ? stats.p25 : table.global.p25;
  const compP75 = stats ? stats.p75 : table.global.p75;
  const quality: 'class' | 'global' = stats ? 'class' : 'global';
  const base = protocol.tvl_usd * compMedian * momentum;
  const implied = Math.max(1, Math.round(base));
  return {
    implied,
    momentum: round4(momentum),
    compMedian: round4(compMedian),
    compP25: round4(compP25),
    compP75: round4(compP75),
    quality,
    group: group ?? 'unclassified',
    groupN: stats ? stats.n : table.global.n,
    why: stats ? stats.why : `no valuation group for ${protocol.category ?? 'an unclassified category'}: the global live-token median stands in`,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
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

/** Confidence says how much of the record stands behind the number: a class comparable with a dated
 *  listing and a reported growth is high, a global fallback with missing dates is low. */
function confidenceOf(p: SnapshotProtocol, quality: 'class' | 'global', table: Comparables): 'high' | 'medium' | 'low' {
  const dated = p.listed_at !== null;
  const growth = p.change_7d !== null;
  if (quality === 'class' && dated && growth) return 'high';
  if (quality === 'class' || (dated && growth)) return 'medium';
  return 'low';
}

/** Farm priority, from the protocol's own record only: big TVL inside the usual pre-token age window
 *  is farmed first, tiny or very old positions are watched. It ranks effort, not a launch prediction. */
function farmPriorityOf(tvl: number, age: number | null): 'first' | 'strong' | 'watch' {
  const ageOk = age === null || (age >= 60 && age <= 900);
  if (tvl >= 250_000_000 && ageOk) return 'first';
  if (tvl >= 50_000_000 || ageOk) return 'strong';
  return 'watch';
}

/** The live-token protocols of one valuation group, biggest TVL first, as the comparable's evidence.
 *  The same deader-than-dead exclusion the comparable table applies, so the page shows the same set. */
function peersOf(snapshot: Snapshot, group: string | null): PeerRow[] {
  if (group === null) return [];
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && valuationGroup(p.category) === group && p.tvl_usd > 0 && (p.mcap_usd as number) / p.tvl_usd >= MODEL.dead_ratio_floor)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, PEER_ROWS)
    .map((p) => ({ name: p.name, category: p.category, mcap_usd: p.mcap_usd as number, tvl_usd: p.tvl_usd, ratio: round4((p.mcap_usd as number) / p.tvl_usd) }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = comparables(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, table, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const bandLow = Math.max(1, Math.round(s.p.tvl_usd * s.compP25 * s.momentum));
    const bandHigh = Math.max(s.implied, Math.round(s.p.tvl_usd * s.compP75 * s.momentum));
    return {
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
      token_status: 'pre-token' as const,
      age_days: ageDays(snapshot.as_of, s.p.listed_at),
      implied_value_usd: s.implied,
      band: { low_value_usd: bandLow, high_value_usd: bandHigh },
      confidence: confidenceOf(s.p, s.quality, table),
      comparable: { group: s.group, n: s.groupN, median: s.compMedian, p25: s.compP25, p75: s.compP75, quality: s.quality },
      farm_priority: farmPriorityOf(s.p.tvl_usd, ageDays(snapshot.as_of, s.p.listed_at)),
      farm_steps: farmSteps(s.p).map(stepText),
    };
  });
}

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

/** What deploying capital there costs, from the chain and the size: an Ethereum mainnet position pays
 *  more gas than an L2 or Solana one, and a bigger position pays more gas than a small one. */
function gasFor(p: SnapshotProtocol, capital: number): string {
  const chain = chainOf(p).toLowerCase();
  const big = capital >= 150 ? 12 : 6;
  if (chain === 'solana' || chain === 'sui' || chain === 'tron') return `about $${big <= 6 ? 2 : 4} of fees`;
  if (chain === 'arbitrum' || chain === 'base' || chain === 'optimism' || chain.includes('zk') || chain === 'polygon') return `about $${big <= 6 ? 2 : 3} of gas`;
  if (chain === 'ethereum') return `about $${big} of gas`;
  return `about $${big - 2} of gas on ${chainOf(p)}`;
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

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator')) return `Deposit $${capital} into one of ${name}'s curated vaults on ${chain} and keep the receipt token.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault or allocation on ${chain} and keep the shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') && !c.includes('canonical')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s delta-neutral or margin product on ${chain} and keep the position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa') || c.includes('private credit') || c.includes('tokeniz')) return `Mint or subscribe $${capital} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain') || c.includes('infrastructure') || c.includes('validator') || c.includes('node')) return `Run or delegate to ${name}'s infrastructure on ${chain}: stake $${capital} through its own staking or node product.`;
  if (c.includes('payment')) return `Settle a real payment of $${Math.max(1, Math.round(capital / 10))} through ${name} on ${chain}, then hold $${capital} in its settlement asset.`;
  if (c.includes('governance')) return `Delegate $${capital} of voting power and vote on one live proposal of ${name}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, ageDaysValue?: number | null): FarmStep[] {
  const age = ageDaysValue === undefined ? null : ageDaysValue;
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(p, capital);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
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
export function radarRow(row: BoardRow, inWatchlist: boolean): RadarRow {
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
    band: row.band,
    confidence: row.confidence,
    comparable: row.comparable,
    farm_priority: row.farm_priority,
    in_watchlist: inWatchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const table = comparables(snapshot);
  const peerTable: Record<string, PeerRow[]> = {};
  for (const g of Object.keys(GROUPS)) peerTable[g] = peersOf(snapshot, g);
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
    comparables: table,
    peer_table: peerTable,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
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

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

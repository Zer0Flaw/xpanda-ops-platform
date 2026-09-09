// src/lib/logistics/flags.ts
// Cross-history flag computation, shared by /v2/api/logistics/invoice (POST response) and
// /v2/api/logistics/flags (GET) so the math never drifts between the two callers.

export interface FlagRow {
  zip: string;
  city: string;
  amount: number;
  miles: number;
}

export interface ZipVarianceEntry {
  zip: string;
  city: string;
  count: number;
  minPrice: number;
  maxPrice: number;
  spread: number;
  avgMiles: number;
}

export interface InversionEntry {
  nearerZip: string;
  nearerMiles: number;
  nearerAvgPrice: number;
  fartherZip: string;
  fartherMiles: number;
  fartherAvgPrice: number;
}

export interface PerZipEntry {
  zip: string;
  city: string;
  count: number;
  avgMiles: number;
  avgPrice: number;
  avgPricePerMile: number;
}

interface ZipAgg {
  zip: string;
  city: string;
  count: number;
  amounts: number[];
  milesSum: number;
}

// Only rows with excluded_from_stats = 0 (i.e. match_status = 'matched') and a real zip/miles
// should be passed in — the caller filters, this just aggregates + compares.
function aggregateByZip(rows: FlagRow[]): ZipAgg[] {
  const byZip = new Map<string, ZipAgg>();
  for (const r of rows) {
    if (!r.zip) continue;
    let agg = byZip.get(r.zip);
    if (!agg) {
      agg = { zip: r.zip, city: r.city, count: 0, amounts: [], milesSum: 0 };
      byZip.set(r.zip, agg);
    }
    agg.count += 1;
    agg.amounts.push(r.amount);
    agg.milesSum += r.miles;
  }
  return Array.from(byZip.values());
}

export function computeZipVariance(rows: FlagRow[]): ZipVarianceEntry[] {
  const aggs = aggregateByZip(rows);
  const out: ZipVarianceEntry[] = [];
  for (const agg of aggs) {
    const minPrice = Math.min(...agg.amounts);
    const maxPrice = Math.max(...agg.amounts);
    const spread = maxPrice - minPrice;
    if (spread <= 0) continue;
    out.push({
      zip: agg.zip,
      city: agg.city,
      count: agg.count,
      minPrice,
      maxPrice,
      spread,
      avgMiles: agg.milesSum / agg.count,
    });
  }
  out.sort((a, b) => b.spread - a.spread);
  return out;
}

export function computeInversions(rows: FlagRow[]): InversionEntry[] {
  const aggs = aggregateByZip(rows);
  const withAvgs = aggs.map((agg) => ({
    zip: agg.zip,
    city: agg.city,
    avgMiles: agg.milesSum / agg.count,
    avgPrice: agg.amounts.reduce((s, a) => s + a, 0) / agg.count,
  }));

  const out: InversionEntry[] = [];
  for (let i = 0; i < withAvgs.length; i++) {
    for (let j = 0; j < withAvgs.length; j++) {
      if (i === j) continue;
      const a = withAvgs[i];
      const b = withAvgs[j];
      if (a.avgMiles < b.avgMiles && a.avgPrice >= b.avgPrice) {
        out.push({
          nearerZip: a.zip,
          nearerMiles: a.avgMiles,
          nearerAvgPrice: a.avgPrice,
          fartherZip: b.zip,
          fartherMiles: b.avgMiles,
          fartherAvgPrice: b.avgPrice,
        });
      }
    }
  }
  return out;
}

export function computePerZip(rows: FlagRow[]): PerZipEntry[] {
  const aggs = aggregateByZip(rows);
  return aggs
    .map((agg) => {
      const avgMiles = agg.milesSum / agg.count;
      const avgPrice = agg.amounts.reduce((s, a) => s + a, 0) / agg.count;
      return {
        zip: agg.zip,
        city: agg.city,
        count: agg.count,
        avgMiles,
        avgPrice,
        avgPricePerMile: avgMiles > 0 ? avgPrice / avgMiles : 0,
      };
    })
    .sort((a, b) => a.zip.localeCompare(b.zip));
}

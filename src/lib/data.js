/**
 * data.js — data access layer.
 * Daily history ships bundled (src/data/history.json, generated from real
 * published Sept 2026 rates). 22K/18K derived from 24K at standard fineness.
 */
import historyRaw from "../data/history.json";

export const METALS = [
  { id: "gold24", label: "Gold 24K", unit: "₹/g", digits: 0, color: "#f5c542", series: "gold24" },
  { id: "gold22", label: "Gold 22K", unit: "₹/g", digits: 0, color: "#e8a93d", series: "gold22" },
  { id: "gold18", label: "Gold 18K", unit: "₹/g", digits: 0, color: "#c98a2e", series: "gold18" },
  { id: "silver", label: "Silver 999", unit: "₹/kg", digits: 0, color: "#c0c8d4", series: "silver" },
];

export function dailySeries() {
  // forward-fill gaps (weekends), drop leading nulls
  const out = [];
  let lg = null, ls = null;
  for (const d of historyRaw.days) {
    if (d.gold24 != null) lg = d.gold24;
    if (d.silver != null) ls = d.silver;
    if (lg == null || ls == null) continue;
    out.push({
      date: d.date,
      gold24: lg,
      gold22: lg * (916 / 999),
      gold18: lg * (750 / 999),
      silver: ls,
    });
  }
  return out;
}

/** Series in {date, gold, silver} shape for the prediction engine. */
export function engineSeries() {
  return dailySeries().map((d) => ({ date: d.date, gold: d.gold24, silver: d.silver }));
}

export function lastClose() {
  const s = dailySeries();
  return s[s.length - 1];
}

export function prevClose() {
  const s = dailySeries();
  return s[s.length - 2];
}

export const SOURCES = historyRaw.sources ?? [];
export const DATA_NOTES = historyRaw.notes ?? "";

export const inr = (v, digits = 0) =>
  "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const pctStr = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

import { Hono } from "hono";

interface TelemetryFrame {
  ts: number;
  lap: number;
  pos: number;
  spd: number;
  thr: number;
  brk: number;
  str: number;
  gear: number;
  rpm: number;
  tyres: { fl: number; fr: number; rl: number; rr: number };
}

interface SectorSummary {
  sector: number;
  time: number;
}

interface LapSummary {
  lapNumber: number;
  lapTime: number;
  sectors: SectorSummary[];
  avgSpeed: number;
  maxSpeed: number;
}

const app = new Hono();
let storedFrames: TelemetryFrame[] = [];

// Filter stationary frames: speed < 5 AND position hasn't changed
function filterStationary(frames: TelemetryFrame[]): TelemetryFrame[] {
  const result: TelemetryFrame[] = [];
  for (const f of frames) {
    const prev = result.at(-1);
    const stationary = f.spd < 5 && (!prev || f.pos === prev.pos);
    if (!stationary) result.push(f);
  }
  return result;
}

function groupByLap(frames: TelemetryFrame[]): Map<number, TelemetryFrame[]> {
  const map = new Map<number, TelemetryFrame[]>();
  for (const f of frames) {
    if (!map.has(f.lap)) map.set(f.lap, []);
    map.get(f.lap)!.push(f);
  }
  return map;
}

// Returns only laps that started from ~0.0 and reached ~1.0
function getCompletedLaps(allFrames: TelemetryFrame[]): Map<number, TelemetryFrame[]> {
  const clean = filterStationary(allFrames);
  const byLap = groupByLap(clean);
  const completed = new Map<number, TelemetryFrame[]>();

  for (const [lapNum, frames] of byLap) {
    const first = frames[0];
    const last = frames.at(-1)!;
    if (first.pos > 0.05) continue; // out-lap: started mid-track
    if (last.pos < 0.95) continue;  // incomplete: didn't finish
    completed.set(lapNum, frames);
  }

  return completed;
}

// Linear interpolation to find exact timestamp at a track position boundary
function interpolateTs(f1: TelemetryFrame, f2: TelemetryFrame, boundary: number): number {
  const ratio = (boundary - f1.pos) / (f2.pos - f1.pos);
  return f1.ts + ratio * (f2.ts - f1.ts);
}

function getSectorCrossTs(frames: TelemetryFrame[], boundary: number): number {
  for (let i = 1; i < frames.length; i++) {
    if (frames[i - 1].pos < boundary && frames[i].pos >= boundary) {
      return interpolateTs(frames[i - 1], frames[i], boundary);
    }
  }
  return frames.at(-1)!.ts;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function computeLapSummary(lapNum: number, frames: TelemetryFrame[]): LapSummary {
  const startTs = frames[0].ts;
  const endTs = frames.at(-1)!.ts;

  const s1EndTs = getSectorCrossTs(frames, 0.333);
  const s2EndTs = getSectorCrossTs(frames, 0.667);

  const speeds = frames.map((f) => f.spd);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  return {
    lapNumber: lapNum,
    lapTime: round3(endTs - startTs),
    sectors: [
      { sector: 1, time: round3(s1EndTs - startTs) },
      { sector: 2, time: round3(s2EndTs - s1EndTs) },
      { sector: 3, time: round3(endTs - s2EndTs) },
    ],
    avgSpeed: round3(avgSpeed),
    maxSpeed: Math.max(...speeds),
  };
}

function stddev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
}

function identifyIssue(frames: TelemetryFrame[]): string {
  // Check tyre overheat
  for (const f of frames) {
    if (Math.max(f.tyres.fl, f.tyres.fr, f.tyres.rl, f.tyres.rr) > 110) {
      return "tyre_overheat";
    }
  }

  // Check heavy braking while still fast
  for (const f of frames) {
    if (f.brk > 0.8 && f.spd > 200) return "heavy_braking";
  }

  // Check low throttle application
  const avgThr = frames.reduce((a, f) => a + f.thr, 0) / frames.length;
  if (avgThr < 0.6) return "low_throttle";

  // Check speed consistency
  if (stddev(frames.map((f) => f.spd)) > 40) return "inconsistency";

  return "inconsistency";
}

const COACHING: Record<string, (sector: number) => string> = {
  tyre_overheat: (s) =>
    `Sector ${s} is killing your lap — you're overheating the tyres and losing grip. Back off the kerbs, smooth inputs on exit.`,
  heavy_braking: (s) =>
    `Sector ${s} — you're braking too late and too hard. Move the braking point earlier, trail it in, carry more mid-corner speed.`,
  low_throttle: (s) =>
    `Sector ${s} — you're leaving time on the table. Get back on the throttle earlier. Commit to the exit, trust the car.`,
  inconsistency: (s) =>
    `Sector ${s} is all over the place. Speed variance is too high. Find one line and repeat it. Consistency before speed.`,
};

// ─── Routes ────────────────────────────────────────────────────────────────

app.post("/ingest", async (c) => {
  const body = await c.req.json<TelemetryFrame[]>();
  storedFrames = body;

  const completed = getCompletedLaps(storedFrames);
  return c.json({ laps: completed.size, frames: storedFrames.length });
});

app.get("/laps", (c) => {
  const completed = getCompletedLaps(storedFrames);

  const summaries = [...completed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lapNum, frames]) => computeLapSummary(lapNum, frames));

  return c.json(summaries);
});

app.get("/analysis", (c) => {
  const completed = getCompletedLaps(storedFrames);

  if (completed.size === 0) {
    return c.json({ error: "No completed laps in stored data" }, 400);
  }

  const entries = [...completed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lapNum, frames]) => ({ summary: computeLapSummary(lapNum, frames), frames }));

  const bestEntry = entries.reduce((a, b) =>
    a.summary.lapTime < b.summary.lapTime ? a : b
  );
  const worstEntry = entries.reduce((a, b) =>
    a.summary.lapTime > b.summary.lapTime ? a : b
  );

  const delta = round3(worstEntry.summary.lapTime - bestEntry.summary.lapTime);

  // Find the sector where worst lap loses the most time vs best lap
  const sectorDeltas = worstEntry.summary.sectors.map((s, i) => ({
    sector: s.sector,
    delta: s.time - bestEntry.summary.sectors[i].time,
  }));
  const worstSector = sectorDeltas.reduce((a, b) => (a.delta > b.delta ? a : b));

  // Extract frames for that sector of the worst lap
  const { sector } = worstSector;
  const sLow = sector === 1 ? 0 : sector === 2 ? 0.333 : 0.667;
  const sHigh = sector === 1 ? 0.333 : sector === 2 ? 0.667 : 1.0;
  const sectorFrames = worstEntry.frames.filter(
    (f) => f.pos >= sLow && f.pos < sHigh
  );

  const issue = identifyIssue(sectorFrames);
  const coachingMessage = (COACHING[issue] ?? COACHING.inconsistency)(sector);

  return c.json({
    bestLap: {
      lapNumber: bestEntry.summary.lapNumber,
      lapTime: bestEntry.summary.lapTime,
    },
    worstLap: {
      lapNumber: worstEntry.summary.lapNumber,
      lapTime: worstEntry.summary.lapTime,
      delta,
    },
    problemSector: sector,
    issue,
    coachingMessage,
  });
});

Bun.serve({ fetch: app.fetch, port: 3000 });
console.log("PitGPT API running on http://localhost:3000");

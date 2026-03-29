# PitGPT Telemetry API

## Hear the coaching message (macOS)

```bash
curl -s http://localhost:3000/analysis \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['coachingMessage'])" \
  | say -v Daniel
```

Bun/Hono API that ingests racing simulator telemetry and returns lap analysis and coaching insights. Built as a solution to the [RACEMAKE Hard Engineer Challenge](https://gist.github.com/743milan/90a461d9b8ac3ec080f50de926590f15).

**Stack:** Bun, Hono, TypeScript

## Run

```bash
bun run challenge-hard.ts
```

## Endpoints

### POST /ingest

```bash
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d @telemetry.json
```

```json
{
  "laps": 3,
  "frames": 166
}
```

---

### GET /laps

```bash
curl http://localhost:3000/laps
```

```json
[
  {
    "lapNumber": 1,
    "lapTime": 133.2,
    "sectors": [
      { "sector": 1, "time": 43.6 },
      { "sector": 2, "time": 47.4 },
      { "sector": 3, "time": 42.2 }
    ],
    "avgSpeed": 227.907,
    "maxSpeed": 291
  },
  {
    "lapNumber": 2,
    "lapTime": 132.8,
    "sectors": [
      { "sector": 1, "time": 42.953 },
      { "sector": 2, "time": 47.147 },
      { "sector": 3, "time": 42.7 }
    ],
    "avgSpeed": 230.605,
    "maxSpeed": 292
  },
  {
    "lapNumber": 3,
    "lapTime": 137.4,
    "sectors": [
      { "sector": 1, "time": 44.422 },
      { "sector": 2, "time": 50.973 },
      { "sector": 3, "time": 42.005 }
    ],
    "avgSpeed": 217.5,
    "maxSpeed": 286
  }
]
```

---

### GET /analysis

```bash
curl http://localhost:3000/analysis
```

```json
{
  "bestLap": {
    "lapNumber": 2,
    "lapTime": 132.8
  },
  "worstLap": {
    "lapNumber": 3,
    "lapTime": 137.4,
    "delta": 4.6
  },
  "problemSector": 2,
  "issue": "tyre_overheat",
  "coachingMessage": "Sector 2 is killing your lap — you're overheating the tyres and losing grip. Back off the kerbs, smooth inputs on exit."
}
```

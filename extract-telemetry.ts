import { telemetry } from "./telemetry-data.ts";
await Bun.write("telemetry.json", JSON.stringify(telemetry, null, 2));
console.log(`Written ${telemetry.length} frames to telemetry.json`);

#!/usr/bin/env node
// Node 24 runs the TypeScript sources directly (type stripping), so there is no build step.
await import("../src/main.ts");

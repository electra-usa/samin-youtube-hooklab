import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError, parseFlags } from "../args.ts";
import type { Command } from "../types.ts";

const APP_DIR = fileURLToPath(new URL("../../../app/", import.meta.url));

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

const command: Command = {
  name: "serve",
  summary: "Start the HookLab app (production build if there is one, else dev)",
  usage: `Usage: hooklab serve [--port N] [--dev | --prod]

Runs the Next.js app in app/: \`npm run start\` when app/.next holds a production build
(\`npm run build\`), otherwise \`npm run dev\`. The API is then at http://localhost:<port>/api/v1.

  --port N   port to listen on (default 3210, or PORT)
  --dev      always use the dev server
  --prod     require the production build

Examples
  hooklab serve
  hooklab serve --port 4000 --dev`,
  async run(argv, ctx) {
    const { values } = parseFlags(argv, { port: { type: "string", short: "p" }, dev: { type: "boolean" }, prod: { type: "boolean" } }, { positionals: false });
    if (values.dev && values.prod) throw new UsageError("Pick one of --dev or --prod.");
    const port = Number(values.port ?? process.env.PORT ?? 3210);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`--port must be a port number (got "${values.port}").`);
    if (!fs.existsSync(path.join(APP_DIR, "package.json"))) throw new Error(`Can't find the app at ${APP_DIR}.`);

    const hasBuild = fs.existsSync(path.join(APP_DIR, ".next", "BUILD_ID"));
    if (values.prod && !hasBuild) throw new Error("No production build in app/.next. Run `npm run build` in app/ first, or use --dev.");
    const mode = values.dev || !hasBuild ? "dev" : "start";

    if (await portInUse(port)) {
      ctx.info(`Port ${port} is already in use. HookLab may already be running at http://localhost:${port} (try \`hooklab stats\` or GET /api/v1).`);
      return 1;
    }
    ctx.info(`Starting HookLab (${mode === "start" ? "production build" : "dev server"}) on http://localhost:${port} …`);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npm, ["run", mode, "--", "-p", String(port)], { cwd: APP_DIR, stdio: "inherit", env: { ...process.env, PORT: String(port) } });
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
    process.on("SIGINT", forward("SIGINT"));
    process.on("SIGTERM", forward("SIGTERM"));
    return await new Promise<number>((resolve) => {
      child.once("error", (err) => {
        ctx.info(`Couldn't start npm: ${err.message}`);
        resolve(1);
      });
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 0 : 1)));
    });
  },
};

export default command;

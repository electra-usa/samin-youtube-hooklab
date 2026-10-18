// Incremental JSON parser for structured model output that arrives in chunks.
// It reports every value as soon as it is complete (onValue) and the growing text of
// string values (onStringChunk), so titles and cards can be sent before the JSON ends.

export type JsonPath = (string | number)[];

type Frame =
  | { kind: "object"; value: Record<string, unknown>; path: JsonPath; key: string | null }
  | { kind: "array"; value: unknown[]; path: JsonPath };

type Mode = "value" | "key" | "colon" | "string" | "number" | "literal" | "after" | "done";

export type JsonStreamHandlers = {
  onValue?: (path: JsonPath, value: unknown) => void;
  onStringChunk?: (path: JsonPath, chunk: string) => void;
};

const WS = new Set([" ", "\n", "\r", "\t"]);
const NUMBER_CHARS = /[0-9eE+\-.]/;

export class JsonStreamParser {
  private stack: Frame[] = [];
  private mode: Mode = "value";
  private token = "";
  private isKey = false;
  private escaping = false;
  private unicode: string | null = null;
  private emitted = 0;
  private stringPath: JsonPath = [];
  root: unknown = undefined;
  private readonly handlers: JsonStreamHandlers;

  constructor(handlers: JsonStreamHandlers = {}) {
    this.handlers = handlers;
  }

  get complete() {
    return this.mode === "done";
  }

  write(chunk: string) {
    for (let i = 0; i < chunk.length; i++) this.step(chunk[i]);
    this.flushString();
  }

  private childPath(): JsonPath {
    const top = this.stack[this.stack.length - 1];
    if (!top) return [];
    return top.kind === "object" ? [...top.path, top.key ?? ""] : [...top.path, top.value.length];
  }

  private flushString() {
    if (this.mode !== "string" || this.isKey || !this.handlers.onStringChunk) return;
    if (this.token.length > this.emitted) {
      this.handlers.onStringChunk(this.stringPath, this.token.slice(this.emitted));
      this.emitted = this.token.length;
    }
  }

  private completeValue(value: unknown, path: JsonPath) {
    const top = this.stack[this.stack.length - 1];
    if (!top) {
      this.root = value;
      this.mode = "done";
    } else {
      if (top.kind === "object") top.value[top.key ?? ""] = value;
      else top.value.push(value);
      this.mode = "after";
    }
    this.handlers.onValue?.(path, value);
  }

  private closeContainer() {
    const frame = this.stack.pop()!;
    this.completeValue(frame.value, frame.path);
  }

  private startValue(c: string): boolean {
    if (c === "{") {
      this.stack.push({ kind: "object", value: {}, path: this.childPath(), key: null });
      this.mode = "key";
    } else if (c === "[") {
      this.stack.push({ kind: "array", value: [], path: this.childPath() });
      this.mode = "value";
    } else if (c === '"') {
      this.mode = "string";
      this.isKey = false;
      this.token = "";
      this.emitted = 0;
      this.stringPath = this.childPath();
    } else if (c === "-" || (c >= "0" && c <= "9")) {
      this.mode = "number";
      this.token = c;
    } else if (c === "t" || c === "f" || c === "n") {
      this.mode = "literal";
      this.token = c;
    } else {
      return false;
    }
    return true;
  }

  private step(c: string) {
    switch (this.mode) {
      case "done":
        return;
      case "value": {
        if (WS.has(c)) return;
        const top = this.stack[this.stack.length - 1];
        if (c === "]" && top?.kind === "array") {
          this.closeContainer();
          return;
        }
        this.startValue(c);
        return;
      }
      case "key":
        if (WS.has(c) || c === ",") return;
        if (c === '"') {
          this.mode = "string";
          this.isKey = true;
          this.token = "";
        } else if (c === "}") {
          this.closeContainer();
        }
        return;
      case "colon":
        if (c === ":") this.mode = "value";
        return;
      case "string":
        if (this.unicode !== null) {
          this.unicode += c;
          if (this.unicode.length === 4) {
            const code = parseInt(this.unicode, 16);
            if (!Number.isNaN(code)) this.token += String.fromCharCode(code);
            this.unicode = null;
          }
          return;
        }
        if (this.escaping) {
          this.escaping = false;
          if (c === "u") this.unicode = "";
          else this.token += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c;
          return;
        }
        if (c === "\\") {
          this.escaping = true;
          return;
        }
        if (c === '"') {
          if (this.isKey) {
            const top = this.stack[this.stack.length - 1];
            if (top?.kind === "object") top.key = this.token;
            this.mode = "colon";
          } else {
            this.flushString();
            this.completeValue(this.token, this.stringPath);
          }
          this.token = "";
          return;
        }
        this.token += c;
        return;
      case "number":
        if (NUMBER_CHARS.test(c)) {
          this.token += c;
          return;
        }
        this.completeValue(Number(this.token), this.childPath());
        this.step(c);
        return;
      case "literal":
        this.token += c;
        if (this.token === "true" || this.token === "false" || this.token === "null") {
          this.completeValue(this.token === "true" ? true : this.token === "false" ? false : null, this.childPath());
        } else if (this.token.length > 5) {
          this.mode = "after";
        }
        return;
      case "after":
        if (WS.has(c)) return;
        if (c === ",") {
          const top = this.stack[this.stack.length - 1];
          this.mode = top?.kind === "object" ? "key" : "value";
        } else if (c === "}" || c === "]") {
          this.closeContainer();
        }
        return;
    }
  }
}

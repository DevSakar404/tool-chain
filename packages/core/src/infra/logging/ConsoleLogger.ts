import type { ILogger } from "../../contracts/IRunContext.js";

export class ConsoleLogger implements ILogger {
  constructor(private readonly prefix: string = "") {}

  info(message: string, meta?: Record<string, unknown>): void {
    console.info(this.fmt("INFO", message), meta ?? "");
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(this.fmt("WARN", message), meta ?? "");
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(this.fmt("ERROR", message), meta ?? "");
  }

  private fmt(level: string, message: string): string {
    return `[${level}]${this.prefix ? ` [${this.prefix}]` : ""} ${message}`;
  }
}

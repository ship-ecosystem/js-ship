export class ConfigError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(problems.join("\n"));
    this.name = "ConfigError";
  }
}

export class ProcessError extends Error {
  constructor(message: string, public readonly exitCode: number, public readonly stdout = "", public readonly stderr = "") {
    super(message);
    this.name = "ProcessError";
  }
}

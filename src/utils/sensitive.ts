const SENSITIVE_COMMAND_PATTERNS: RegExp[] = [
  /^\s+/, // Leading space conventionally omits shell history
  /\b(passwd|chpasswd|htpasswd|sshpass|pwgen)\b/i,
  /\bsudo\s+-S\b/i,
  /\bmysql(dump)?\b[^\n]*\s-p\S+/i,
  /\bmysql(dump)?\b[^\n]*--password[=\s]/i,
  /\b(PGPASSWORD|MYSQL_PWD|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|API_KEY|SECRET_KEY|PASSWORD|PASSWD|TOKEN)\s*=/i,
  /--(password|passwd|passphrase|secret|token|api-key)[=\s]\S+/i,
  /(^|\s)-p\s+\S+/i,
  /\bAuthorization:\s*Bearer\s+\S+/i,
  /\bcurl\b[^\n]*\s(-u|--user)\s+\S+:\S+/i,
  /\bopenssl\s+passwd\b/i,
];

const PASSWORD_PROMPT_PATTERNS: RegExp[] = [
  /password(?:\s+for\b.*)?:\s*$/i,
  /passphrase(?:\s+for\b.*)?:\s*$/i,
  /enter\s+pin.*:\s*$/i,
  /\[sudo\]\s*.*:\s*$/i,
  /(密码|口令)[：:]\s*$/,
];

export function isSensitiveCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  if (command.startsWith(" ")) return true;
  return SENSITIVE_COMMAND_PATTERNS.some(pattern => pattern.test(command));
}

export function looksLikePasswordPrompt(outputTail: string): boolean {
  const lines = outputTail.replace(/\r/g, "").split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  const cleaned = lastLine.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd();
  return PASSWORD_PROMPT_PATTERNS.some(pattern => pattern.test(cleaned));
}

export function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>();
  const matches = template.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g);
  for (const match of matches) {
    if (match[1]) seen.add(match[1]);
  }
  return [...seen];
}

export function applyTemplateVariables(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (full, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : full,
  );
}

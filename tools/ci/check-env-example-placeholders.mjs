import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_EXAMPLE_PATH = resolve(process.cwd(), '.env.example');
const PLACEHOLDER_PATTERN = /^<INSERT_[A-Z0-9_]+>$/;
const SECRET_KEY_PARTS = ['PASSWORD', 'SECRET', 'TOKEN', 'API_KEY', 'SALT'];

const isSecretLikeKey = (key) => {
  return (
    key === 'LANGSMITH_WORKSPACE_ID' ||
    SECRET_KEY_PARTS.some((part) => key.includes(part))
  );
};

const file = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
const lines = file.split(/\r?\n/u);

let checkedCount = 0;
const violations = [];

for (const [index, line] of lines.entries()) {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    continue;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex < 0) {
    continue;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const value = trimmed.slice(separatorIndex + 1).trim();

  if (!isSecretLikeKey(key)) {
    continue;
  }

  checkedCount += 1;

  if (!PLACEHOLDER_PATTERN.test(value)) {
    violations.push({
      key,
      line: index + 1,
      value
    });
  }
}

if (violations.length > 0) {
  console.error(
    'Found non-placeholder values for secret-like keys in .env.example:'
  );

  for (const violation of violations) {
    console.error(
      `  - line ${violation.line}: ${violation.key}=${violation.value}`
    );
  }

  process.exit(1);
}

console.log(
  `Secret-like placeholder policy passed for ${checkedCount} key(s) in .env.example.`
);

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/** Lints a snippet as if it lived at `filePath` and returns the rule ids that fired. */
async function lintRules(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'parse-error');
}

describe('client code must not import server code (TC-7)', () => {
  it.each([
    ['alias', "import { getContainer } from '@/server/container';\nexport const x = getContainer;\n"],
    ['relative path', "import { openDatabase } from '../server/db/open';\nexport const x = openDatabase;\n"],
    ['native sqlite', "import Database from 'better-sqlite3';\nexport const x = Database;\n"],
    ['node builtin', "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n"],
  ])('forbids a %s import in src/client', async (_label, code) => {
    expect(await lintRules('src/client/Bad.tsx', code)).toContain('no-restricted-imports');
  });

  it('forbids server imports in app/**/*.tsx components as well', async () => {
    const code = "import { getContainer } from '@/server/container';\nexport default function P() { return getContainer() ? null : null; }\n";
    expect(await lintRules('app/page.tsx', code)).toContain('no-restricted-imports');
  });

  it('still allows the shared contract in client code', async () => {
    const code = "import { nameSchema } from '@/shared/schemas';\nexport const x = nameSchema;\n";
    expect(await lintRules('src/client/Good.tsx', code)).not.toContain('no-restricted-imports');
  });

  it('allows server imports in route handlers', async () => {
    const code = "import { getContainer } from '@/server/container';\nexport const GET = () => getContainer();\n";
    expect(await lintRules('app/api/example/route.ts', code)).not.toContain('no-restricted-imports');
  });
});

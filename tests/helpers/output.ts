import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vitest';

export async function testOutputDirectory(test: TestContext, prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), `vehicle-${prefix}-`));
  test.onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

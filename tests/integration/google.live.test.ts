import { describe, expect, it } from 'vitest';
import { buildDeps } from '../../src/bootstrap.js';
import { loadConfig } from '../../src/config/env.js';
import { loadDotEnv } from '../../src/config/paths.js';
import { nullLogger } from '../../src/logging/logger.js';

/**
 * Opt-in live tests. Run with: npm run test:integration
 * Requires `npm run auth` to have been completed, plus:
 *   TEST_EMAIL_RECIPIENT  - a controlled test mailbox
 *   TEST_DOCUMENT_ID      - a disposable Google Doc the account can edit
 */
const enabled = process.env.RUN_GOOGLE_INTEGRATION_TESTS === 'true';

describe.skipIf(!enabled)('live Google APIs', () => {
  loadDotEnv();
  const deps = buildDeps(loadConfig(), nullLogger);
  const recipient = process.env.TEST_EMAIL_RECIPIENT;
  const docId = process.env.TEST_DOCUMENT_ID;

  it('authorization is valid', async () => {
    expect((await deps.auth.check()).state).toBe('ok');
  });
  it.skipIf(!recipient)('sends a test email', async () => {
    const res = await deps.gmail!.send({ to: recipient, subject: `MCP integration test ${Date.now()}`, body_text: 'Automated test message.' });
    expect(res.message_id).toBeTruthy();
  });
  it.skipIf(!docId)('appends a uniquely marked string', async () => {
    const res = await deps.docs!.append({ document: docId, text: `MCP integration test marker ${Date.now()}` });
    expect(res.document_id).toBe(docId);
  });
});

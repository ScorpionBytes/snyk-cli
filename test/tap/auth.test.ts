import { test } from 'tap';
import * as sinon from 'sinon';
import stripAnsi = require('strip-ansi');
import * as auth from '../../src/cli/commands/auth/verify';
import * as errors from '../../src/lib/errors/legacy-errors';
import { fakeServer } from '../acceptance/fake-server';
import { getServerPort } from '../jest/util/getServerPort';

const port = getServerPort(process);

const apiKey = '123456789';
const BASE_API = '/api/v1';
process.env.SNYK_API = 'http://localhost:' + port + BASE_API;
process.env.SNYK_HOST = 'http://localhost:' + port;
process.env.LOG_LEVEL = '0';

const server = fakeServer(BASE_API, apiKey);

// ensure this is required *after* the demo server, since this will
// configure our fake configuration too
import * as cli from '../../src/cli/commands';

test('setup', (t) => {
  t.plan(1);

  server.listen(port, () => {
    t.pass('started demo server');
  });
});

test('auth shows an appropriate error message when a request times out', async (t) => {
  const failedReq = new Promise((resolve) => {
    return resolve({ res: { statusCode: 502 } });
  });
  const verifyStub = sinon.stub(auth, 'verifyAPI').returns(failedReq);

  t.teardown(() => {
    verifyStub.restore();
  });

  try {
    await cli.auth(apiKey);
    t.fail('Authentication should have failed');
  } catch (e) {
    const message = stripAnsi(errors.message(e));
    t.ok(message.includes('request has timed out'), 'correct error message');
  }
});

test('auth shows an appropriate error message when a request fails with a user message', async (t) => {
  const userMessage = 'Oh no! The request failed';
  const failedReq = new Promise((resolve) => {
    return resolve({ res: { statusCode: 502, body: { userMessage } } });
  });
  const verifyStub = sinon.stub(auth, 'verifyAPI').returns(failedReq);

  t.teardown(() => {
    verifyStub.restore();
  });

  try {
    await cli.auth(apiKey);
    t.fail('Authentication should have failed');
  } catch (e) {
    const message = stripAnsi(errors.message(e));
    t.equal(message, userMessage, 'userMessage shown on auth failure');
  }
});

test('teardown', (t) => {
  t.plan(2);

  delete process.env.SNYK_API;
  delete process.env.SNYK_HOST;
  delete process.env.SNYK_PORT;
  t.notOk(process.env.SNYK_PORT, 'fake env values cleared');

  server.close(() => {
    t.pass('server shutdown');
  });
});

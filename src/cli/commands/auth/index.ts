import * as open from 'open';
import { v4 as uuidv4 } from 'uuid';
import * as Debug from 'debug';
import { Spinner } from 'cli-spinner';
import * as snyk from '../../../lib';
import { verifyAPI } from './verify';
import { isCI } from '../../../lib/is-ci';
import { isDocker } from '../../../lib/is-docker';
import { args as argsLib } from '../../args';
import config from '../../../lib/config';
import { makeRequest } from '../../../lib/request';
import { CustomError } from '../../../lib/errors';
import { AuthFailedError } from '../../../lib/errors';
import { TokenExpiredError } from '../../../lib/errors/token-expired-error';
import { MisconfiguredAuthInCI } from '../../../lib/errors/misconfigured-auth-in-ci-error';
import { Payload } from '../../../lib/request/types';
import { getQueryParamsAsString } from '../../../lib/query-strings';

const apiUrl = new URL(config.API);
// Ensure user gets redirected to the login page
if (apiUrl.host.startsWith('api.')) {
  apiUrl.host = apiUrl.host.replace(/^api\./, 'app.');
}
const debug = Debug('snyk-auth');
let attemptsLeft = 0;

function resetAttempts() {
  attemptsLeft = isDocker() ? 60 : 3 * 60;
}

async function webAuth() {
  const token = uuidv4(); // generate a random key

  apiUrl.pathname = '/login';
  apiUrl.searchParams.append('token', token);
  let urlStr = apiUrl.toString();

  // It's not optimal, but I have to parse args again here. Alternative is reworking everything about how we parse args
  const args = [argsLib(process.argv).options];
  const utmParams = getQueryParamsAsString(args);
  if (utmParams) {
    urlStr += '&' + utmParams;
  }

  // suppress this message in CI
  if (!isCI()) {
    console.log(browserAuthPrompt(isDocker(), urlStr));
  } else {
    return Promise.reject(MisconfiguredAuthInCI());
  }
  const spinner = new Spinner('Waiting...');
  spinner.setSpinnerString('|/-\\');

  const ipFamily = await getIpFamily();

  try {
    spinner.start();
    if (!isDocker()) {
      await setTimeout(() => {
        open(urlStr);
      }, 0);
    }

    return await testAuthComplete(token, ipFamily);
  } finally {
    spinner.stop(true);
  }
}

async function testAuthComplete(
  token: string,
  ipFamily?: number,
): Promise<{ res; body }> {
  const payload: Partial<Payload> = {
    body: {
      token,
    },
    url: config.API + '/verify/callback',
    json: true,
    method: 'post',
  };

  if (ipFamily) {
    payload.family = ipFamily;
  }

  return new Promise((resolve, reject) => {
    debug(payload);
    makeRequest(payload, (error, res, body) => {
      debug(error, (res || {}).statusCode, body);
      if (error) {
        return reject(error);
      }

      if (res.statusCode !== 200) {
        return reject(errorForFailedAuthAttempt(res, body));
      }

      // we have success
      if (body.api) {
        return resolve({
          res,
          body,
        });
      }

      // we need to wait and poll again in a moment
      setTimeout(() => {
        attemptsLeft--;
        if (attemptsLeft > 0) {
          return resolve(testAuthComplete(token, ipFamily));
        }

        reject(TokenExpiredError());
      }, 1000);
    });
  });
}

export default async function auth(apiToken: string): Promise<string> {
  let promise;
  resetAttempts();
  if (apiToken) {
    // user is manually setting the API token on the CLI - let's trust them
    promise = verifyAPI(apiToken);
  } else {
    promise = webAuth();
  }

  return promise.then((data) => {
    const res = data.res;
    const body = res.body;
    debug(body);

    if (res.statusCode === 200 || res.statusCode === 201) {
      snyk.config.set('api', body.api);
      return (
        '\nYour account has been authenticated. Snyk is now ready to ' +
        'be used.\n'
      );
    }
    throw errorForFailedAuthAttempt(res, body);
  });
}

/**
 * Resolve an appropriate error for a failed attempt to authenticate
 *
 * @param res The response from the API
 * @param body The body of the failed authentication request
 */
function errorForFailedAuthAttempt(res, body) {
  if (res.statusCode === 401 || res.statusCode === 403) {
    return AuthFailedError(body.userMessage, res.statusCode);
  } else {
    const userMessage = body && body.userMessage;
    const error = new CustomError(userMessage || 'Auth request failed');
    if (userMessage) {
      error.userMessage = userMessage;
    }
    error.code = res.statusCode;
    return error;
  }
}

async function getIpFamily(): Promise<6 | undefined> {
  const family = 6;
  try {
    // Dispatch a FORCED IPv6 request to test client's ISP and network capability
    await makeRequest({
      url: config.API + '/verify/callback',
      family, // family param forces the handler to dispatch a request using IP at "family" version
      method: 'post',
    });
    return family;
  } catch (e) {
    return undefined;
  }
}

function browserAuthPrompt(isDocker: boolean, urlStr: string): string {
  if (isDocker) {
    return (
      '\nTo authenticate your account, open the below URL in your browser.\n' +
      'After your authentication is complete, return to this prompt to ' +
      'start using Snyk.\n\n' +
      urlStr +
      '\n'
    );
  } else {
    return (
      '\nNow redirecting you to our auth page, go ahead and log in,\n' +
      "and once the auth is complete, return to this prompt and you'll\n" +
      "be ready to start using snyk.\n\nIf you can't wait use this url:\n" +
      urlStr +
      '\n'
    );
  }
}

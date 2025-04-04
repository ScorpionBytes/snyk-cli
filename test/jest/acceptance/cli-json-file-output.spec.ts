import { fakeServer } from '../../acceptance/fake-server';
import * as fs from 'fs';
import { createProjectFromWorkspace } from '../util/createProject';
import { runSnykCLI } from '../util/runSnykCLI';
import { humanFileSize } from '../../utils';
import { getServerPort } from '../util/getServerPort';
import * as depGraphLib from '@snyk/dep-graph';

jest.setTimeout(1000 * 60);

describe('test --json-file-output', () => {
  let server: ReturnType<typeof fakeServer>;
  let env: Record<string, string>;

  beforeAll((done) => {
    const apiPath = '/api/v1';
    const apiPort = getServerPort(process);
    env = {
      ...process.env,
      SNYK_API: 'http://localhost:' + apiPort + apiPath,
      SNYK_TOKEN: '123456789',
      SNYK_DISABLE_ANALYTICS: '1',
    };

    server = fakeServer(apiPath, env.SNYK_TOKEN);
    server.listen(apiPort, () => done());
  });

  afterEach(() => {
    server.restore();
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('can save JSON output to file while sending human readable output to stdout', async () => {
    const project = await createProjectFromWorkspace('no-vulns');
    const outputPath = 'json-file-output.json';

    const { code, stdout } = await runSnykCLI(
      `test --json-file-output=${outputPath}`,
      {
        cwd: project.path(),
        env,
      },
    );

    expect(code).toEqual(0);
    expect(stdout).toMatch('Organization:');
    expect(await project.readJSON(outputPath)).toMatchObject({ ok: true });
  });

  it('test --json-file-output produces same JSON output as normal JSON output to stdout', async () => {
    const project = await createProjectFromWorkspace('no-vulns');
    const outputPath = 'json-file-output.json';

    const { code, stdout } = await runSnykCLI(
      `test --json --json-file-output=${outputPath}`,
      {
        cwd: project.path(),
        env,
      },
    );
    expect(code).toEqual(0);
    expect(await project.read(outputPath)).toEqual(stdout);
  });

  it('test --json-file-ouput handles responses larger than 512Mb string size limit in v8', async () => {
    const project = await createProjectFromWorkspace(
      'extra-large-response-payload',
    );
    const outputFilename = 'json-file-output.json';
    const response = await project.readJSON('vulns-result.json');
    const reference =
      response.result.issuesData['SNYK-ALPINE319-OPENSSL-6148881']
        .references[0];
    response.result.issuesData['SNYK-ALPINE319-OPENSSL-6148881'].references =
      new Array(420000).fill(reference);

    server.setCustomResponse(response);

    const { code, stdout, stderr } = await runSnykCLI(
      `container test hello-world:latest --json-file-output=${outputFilename}`,
      {
        cwd: project.path(),
        env,
      },
    );

    console.debug({ stdout, stderr });
    expect(code).toEqual(1);

    const outputPath = await project.path(outputFilename);
    const fileSize = fs.statSync(outputPath).size;

    console.info({
      outputPath,
      outputPathSize: humanFileSize(fileSize),
    });
    expect(fileSize).toBeGreaterThan(500000000); // ~0.5GB
  }, 120000);

  it('code test --json-file-ouput does not write an empty file if no issues are found', async () => {
    const project = await createProjectFromWorkspace('golang-gomodules');
    const outputFilename = project.path() + '/shouldnt_be_there.json';

    const { code } = await runSnykCLI(
      `code test --json-file-output=${outputFilename} ${project.path()}`,
    );

    const fileExists = fs.existsSync(outputFilename);
    expect(fileExists).toBeFalsy();
    expect(code).toEqual(0);
  });

  describe('print-deps and json-file-output', () => {
    it('saves JSON output to file with depGraph when --print-deps and --json-file-output are being used', async () => {
      const project = await createProjectFromWorkspace('maven-app');
      const outputPath = 'json-file-output.json';

      const { code } = await runSnykCLI(
        `test --print-deps --json-file-output=${outputPath}`,
        {
          cwd: project.path(),
          env,
        },
      );

      expect(code).toEqual(0);
      const json = await project.readJSON(outputPath);
      expect(json.depGraph).toBeTruthy();
      const depGraph = depGraphLib.createFromJSON(json.depGraph);
      expect(depGraph.getPkgs()).toContainEqual({
        name: 'axis:axis',
        version: '1.4',
      });
    });

    it('saves JSON output to file without a depGraph when --print-deps is not used', async () => {
      const project = await createProjectFromWorkspace('maven-app');
      const outputPath = 'json-file-output.json';

      const { code } = await runSnykCLI(
        `test --json-file-output=${outputPath}`,
        {
          cwd: project.path(),
          env,
        },
      );

      expect(code).toEqual(0);
      const json = await project.readJSON(outputPath);
      expect(json.depGraph).toBeUndefined();
    });
  });

  describe('print-tree and json-file-output', () => {
    it('saves JSON output to file with depTree when --print-tree and --json-file-output are being used', async () => {
      const project = await createProjectFromWorkspace('maven-app');
      const outputPath = 'json-file-output.json';

      const { code } = await runSnykCLI(
        `test --print-tree --json-file-output=${outputPath}`,
        {
          cwd: project.path(),
          env,
        },
      );

      expect(code).toEqual(0);
      const json = await project.readJSON(outputPath);
      expect(json.depTree).toEqual({
        name: 'com.mycompany.app:maven-app',
        packageFormatVersion: 'mvn:0.0.1',
        type: 'maven',
        version: '1.0-SNAPSHOT',
        dependencies: {
          'axis:axis': {
            name: 'axis:axis',
            version: '1.4',
            dependencies: expect.any(Object),
          },
        },
      });
    });

    it('saves JSON output to file without a depTree when --print-tree is not used', async () => {
      const project = await createProjectFromWorkspace('maven-app');
      const outputPath = 'json-file-output.json';

      const { code } = await runSnykCLI(
        `test --json-file-output=${outputPath}`,
        {
          cwd: project.path(),
          env,
        },
      );

      expect(code).toEqual(0);
      const json = await project.readJSON(outputPath);
      expect(json.depTree).toBeUndefined();
    });
  });
});

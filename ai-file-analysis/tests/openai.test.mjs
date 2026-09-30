import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = { clients: [], calls: [] };

class MockOpenAI {
  constructor(options) {
    state.clients.push(options);
    this.responses = {
      create: async (request) => {
        state.calls.push(request);
        return {
          output_text: JSON.stringify({
            type: 'invoice',
            confidence: 0.97,
            data: { amount: 1250 },
            action: 'create_invoice',
            summary: 'Invoice',
          }),
        };
      },
    };
  }
}

async function loadOpenAIModule(env = {}) {
  const sandbox = createContext({
    Buffer,
    setTimeout,
    console: { log() {}, warn() {}, error() {} },
    process: {
      env: {
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'test-model',
        ...env,
      },
    },
  });
  const openaiModule = new SyntheticModule(['default'], function () {
    this.setExport('default', MockOpenAI);
  }, { context: sandbox, identifier: 'openai' });

  const path = resolve(root, 'lib/openai-vision.ts');
  const source = await readFile(path, 'utf8');
  const mod = new SourceTextModule(stripTypeScriptTypes(source), {
    context: sandbox,
    identifier: path,
  });
  await mod.link(async (specifier) => {
    if (specifier === 'openai') return openaiModule;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await mod.evaluate();
  return mod.namespace;
}

test('uses Responses API image input for supported images', async () => {
  state.clients.length = 0;
  state.calls.length = 0;
  const api = await loadOpenAIModule();
  const result = await api.analyzeWithVision(
    Buffer.from('image-data'),
    'image/png',
    'invoice',
    'invoice.png'
  );

  assert.equal(result.type, 'invoice');
  assert.equal(state.clients[0].apiKey, 'test-key');
  assert.equal(state.calls.length, 1);
  const request = state.calls[0];
  assert.equal(request.model, 'test-model');
  const content = request.input[0].content;
  assert.equal(content[0].type, 'input_text');
  assert.equal(content[1].type, 'input_image');
  assert.match(content[1].image_url, /^data:image\/png;base64,/);
  assert.equal('messages' in state.clients[0], false);
});

for (const [label, mimeType, filename] of [
  ['PDF', 'application/pdf', 'invoice.pdf'],
  ['Excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'fleet.xlsx'],
]) {
  test(`uses Responses API input_file for ${label}`, async () => {
    state.calls.length = 0;
    const api = await loadOpenAIModule();
    await api.analyzeWithVision(Buffer.from(`${label}-data`), mimeType, 'business document', filename);

    const content = state.calls[0].input[0].content;
    assert.equal(content[1].type, 'input_file');
    assert.equal(content[1].filename, filename);
    assert.equal(content[1].file_data, Buffer.from(`${label}-data`).toString('base64'));
  });
}

test('rejects unsupported files before creating an OpenAI client', async () => {
  state.clients.length = 0;
  state.calls.length = 0;
  const api = await loadOpenAIModule();
  await assert.rejects(
    api.analyzeWithVision(Buffer.from('zip'), 'application/zip', undefined, 'archive.zip'),
    /Unsupported analysis file type/
  );
  assert.equal(state.clients.length, 0);
  assert.equal(state.calls.length, 0);
});

test('fails fast when OPENAI_API_KEY is missing', async () => {
  state.clients.length = 0;
  state.calls.length = 0;
  const api = await loadOpenAIModule({ OPENAI_API_KEY: '' });
  await assert.rejects(
    api.analyzeWithRetry(Buffer.from('image'), 'image/png', undefined, 'image.png'),
    /OPENAI_API_KEY is not configured/
  );
  assert.equal(state.clients.length, 0);
  assert.equal(state.calls.length, 0);
});

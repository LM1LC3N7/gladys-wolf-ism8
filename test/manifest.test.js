// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTIONS, DHW_CAP, LINK } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...manifest.actions.flatMap((item) => item.fields ?? []),
];

test('the store basics: one version everywhere, never pinned by hand twice', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-wolf-ism8:${manifest.version}`);
  assert.equal(manifest.containers[0].docker_image, manifest.docker_image);
  assert.match(pkg.dependencies['@gladysassistant/integration-sdk'], /^\^/, 'never pinned');
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['climate']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(manifest.countries, undefined);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /not\s+affiliated\s+with\s+Wolf|sans\s+lien\s+avec\s+Wolf/i);
    assert.match(
      docs,
      /never\s+tested\s+with\s+a\s+real\s+ISM8i|jamais\s+testé\s+avec\s+un\s+vrai\s+ISM8i/i,
    );
    assert.match(
      docs,
      /trusted\s+network|réseau\s+de\s+confiance/i,
      'say the ISM8 has no password',
    );
    assert.match(docs, /65\s*°C/, 'document the hot water ceiling');
    assert.match(
      docs,
      /network_mode|host network|réseau hôte/i,
      'document how the connection reaches the container',
    );
  }
  assert.match(manifest.config_schema[0].description.fr, /Jamais testé avec un vrai ISM8i/);
  assert.match(manifest.config_schema[0].description.en, /Never tested with a real ISM8i/);
  assert.match(read('README.md'), /never tested with a real ISM8i/i);
});

test('every text is in English and French; no "encrypted" anywhere', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr|encrypt|hachage/i, file);
  }
});

test('the sub-container: started by the integration, one TCP port named for the placeholder', () => {
  assert.equal(manifest.containers.length, 1);
  const [link] = manifest.containers;
  assert.equal(link.name, LINK.name);
  assert.deepEqual(link.command, ['node', 'src/receiver.js']);
  assert.equal(link.start, 'manual', 'nothing listens before the configuration');
  assert.equal(link.read_only, true);
  assert.ok(link.memory_mb <= 64);
  assert.deepEqual(
    link.ports.map((p) => [p.container_port, p.protocol, p.name, p.browsable]),
    [[LINK.ism8Port, 'tcp', LINK.portName, false]],
  );
  const section = manifest.config_schema.find((f) => f.key === 'connection_section');
  for (const lang of ['en', 'fr']) assert.match(section.description[lang], /\{\{port:ism8\}\}/);
  assert.equal(manifest.network_discovery, undefined);
  assert.equal(manifest.network_wake, undefined);
});

test('the configuration matches the code; writes are off; the hot water ceiling bounded', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  for (const field of manifest.config_schema) {
    assert.doesNotMatch(field.key, /^gladys_/, field.key);
    assert.notEqual(field.type, 'secret', 'the ISM8 has no secret');
  }
  assert.equal(fields.allow_writes.type, 'boolean');
  assert.equal(fields.allow_writes.default, false);
  assert.equal(fields.check_source.default, true);
  assert.deepEqual(
    [
      fields.dhw_max_temperature.default,
      fields.dhw_max_temperature.min,
      fields.dhw_max_temperature.max,
    ],
    [DHW_CAP.default, DHW_CAP.min, DHW_CAP.max],
  );
  assert.equal(DHW_CAP.max, 65);
  assert.equal(DHW_CAP.default, 65);
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
  for (const option of fields.language.options) {
    assert.equal(typeof option.value, 'string');
    for (const lang of ['en', 'fr']) assert.equal(typeof option.label[lang], 'string');
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
});

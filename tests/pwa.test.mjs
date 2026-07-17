// tests/pwa.test.mjs — v0.5.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'manifest.webmanifest');

describe('PWA manifest.webmanifest', () => {
  let manifest;

  it('is valid JSON', () => {
    const raw = readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
    assert.ok(manifest);
  });

  it('has required name field', () => {
    assert.ok(manifest.name, 'name is required');
    assert.equal(typeof manifest.name, 'string');
  });

  it('has required short_name field', () => {
    assert.ok(manifest.short_name, 'short_name is required');
  });

  it('has start_url', () => {
    assert.ok(manifest.start_url, 'start_url is required');
  });

  it('has display standalone', () => {
    assert.equal(manifest.display, 'standalone');
  });

  it('has icons array with at least one entry', () => {
    assert.ok(Array.isArray(manifest.icons));
    assert.ok(manifest.icons.length >= 1);
  });

  it('each icon has src, sizes, and type', () => {
    for (const icon of manifest.icons) {
      assert.ok(icon.src, 'icon must have src');
      assert.ok(icon.sizes, 'icon must have sizes');
      assert.ok(icon.type, 'icon must have type');
    }
  });

  it('has theme_color', () => {
    assert.ok(manifest.theme_color);
  });

  it('has background_color', () => {
    assert.ok(manifest.background_color);
  });
});

describe('service-worker.js exists', () => {
  it('file can be read', () => {
    const swPath = resolve(__dirname, '..', 'service-worker.js');
    const content = readFileSync(swPath, 'utf-8');
    assert.ok(content.includes('lsk-cache-v0.8.5'));
    assert.ok(content.includes('install'));
    assert.ok(content.includes('activate'));
    assert.ok(content.includes('fetch'));
  });
});

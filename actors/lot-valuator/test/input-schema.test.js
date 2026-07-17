import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

const schema = JSON.parse(
    readFileSync(new URL('../.actor/INPUT_SCHEMA.json', import.meta.url), 'utf8'),
);

test('input schema preserves the batchSize field', () => {
    const field = schema.properties.batchSize;
    assert.ok(field, 'batchSize must exist in input schema');
    assert.equal(field.type, 'integer');
});

test('input schema exposes testGeminiComparables as a boolean field', () => {
    const field = schema.properties.testGeminiComparables;
    assert.ok(field, 'testGeminiComparables must exist in input schema');
    assert.equal(field.type, 'boolean');
});

test('input schema exposes comparableQuery as a string field', () => {
    const field = schema.properties.comparableQuery;
    assert.ok(field, 'comparableQuery must exist in input schema');
    assert.equal(field.type, 'string');
});

test('input schema exposes comparableLimit as an integer field', () => {
    const field = schema.properties.comparableLimit;
    assert.ok(field, 'comparableLimit must exist in input schema');
    assert.equal(field.type, 'integer');
    assert.ok(field.minimum >= 1, 'comparableLimit minimum must be at least 1');
    assert.ok(field.maximum <= 25, 'comparableLimit maximum must not exceed 25');
});

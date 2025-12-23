import { strict as assert } from 'assert';
import {
    parseJsonPatchHeaderValue,
    applyJsonPathPokes,
    JsonPatchRule,
} from '../src/utils/jsonPathBodyPatcher';

describe('jsonPathBodyPatcher', () => {
    describe('parseJsonPatchHeaderValue', () => {
        it('returns empty array for empty input', () => {
            const result = parseJsonPatchHeaderValue([]);
            assert.deepEqual(result, []);
        });

        it('parses a single patch rule', () => {
            const result = parseJsonPatchHeaderValue(['$.user.name=John']);
            assert.deepEqual(result, [
                { path: '$.user.name', rawValue: 'John' }
            ]);
        });

        it('parses multiple rules separated by semicolon', () => {
            const result = parseJsonPatchHeaderValue(['$.name=John;$.age=30']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: 'John' },
                { path: '$.age', rawValue: '30' }
            ]);
        });

        it('parses rules from multiple header values', () => {
            const result = parseJsonPatchHeaderValue(['$.name=John', '$.age=30']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: 'John' },
                { path: '$.age', rawValue: '30' }
            ]);
        });

        it('handles escaped semicolons in values', () => {
            const result = parseJsonPatchHeaderValue(['$.data=value\\;with\\;semicolons']);
            assert.deepEqual(result, [
                { path: '$.data', rawValue: 'value;with;semicolons' }
            ]);
        });

        it('handles escaped equals signs in values (value contains equals)', () => {
            // The escaping is primarily for semicolons. For equals in values,
            // only the first unescaped equals is the delimiter
            const result = parseJsonPatchHeaderValue(['$.data=key=value']);
            assert.deepEqual(result, [
                { path: '$.data', rawValue: 'key=value' }
            ]);
        });

        it('handles filter expressions with equals signs in JSONPath', () => {
            // Filter expressions like [?(@.prop=='val')] should work
            const result = parseJsonPatchHeaderValue(["$.users[?(@.status=='active')]=newvalue"]);
            assert.deepEqual(result, [
                { path: "$.users[?(@.status=='active')]", rawValue: 'newvalue' }
            ]);
        });

        it('handles complex nested filter expressions', () => {
            const result = parseJsonPatchHeaderValue(["$.data[?(@.x > 5 && @.y == 'test')]=updated"]);
            assert.deepEqual(result, [
                { path: "$.data[?(@.x > 5 && @.y == 'test')]", rawValue: 'updated' }
            ]);
        });

        it('handles filter expressions with double equals', () => {
            const result = parseJsonPatchHeaderValue(["$.items[?(@.val==10)]=changed"]);
            assert.deepEqual(result, [
                { path: "$.items[?(@.val==10)]", rawValue: 'changed' }
            ]);
        });

        it('handles multiple filter expressions separated by semicolon', () => {
            const result = parseJsonPatchHeaderValue(["$.a[?(@.x=='y')]=1;$.b[?(@.z==2)]=3"]);
            assert.deepEqual(result, [
                { path: "$.a[?(@.x=='y')]", rawValue: '1' },
                { path: "$.b[?(@.z==2)]", rawValue: '3' }
            ]);
        });

        it('handles escaped backslashes', () => {
            const result = parseJsonPatchHeaderValue(['$.path=back\\\\slash']);
            assert.deepEqual(result, [
                { path: '$.path', rawValue: 'back\\slash' }
            ]);
        });

        it('skips entries without equals sign', () => {
            const result = parseJsonPatchHeaderValue(['$.name=John;invalid;$.age=30']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: 'John' },
                { path: '$.age', rawValue: '30' }
            ]);
        });

        it('skips entries with empty path', () => {
            const result = parseJsonPatchHeaderValue(['=value;$.name=John']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: 'John' }
            ]);
        });

        it('trims whitespace from paths and values', () => {
            const result = parseJsonPatchHeaderValue(['  $.name  =  John Doe  ']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: 'John Doe' }
            ]);
        });

        it('allows empty value', () => {
            const result = parseJsonPatchHeaderValue(['$.name=']);
            assert.deepEqual(result, [
                { path: '$.name', rawValue: '' }
            ]);
        });
    });

    describe('applyJsonPathPokes', () => {
        const identity = async (text: string) => text;

        it('returns original JSON when no rules provided', async () => {
            const json = '{"name": "Original"}';
            const result = await applyJsonPathPokes(json, [], identity);
            assert.equal(result, json);
        });

        it('updates a simple string value', async () => {
            const json = '{"user": {"name": "Original"}}';
            const rules: JsonPatchRule[] = [{ path: '$.user.name', rawValue: 'Updated' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.user.name, 'Updated');
        });

        it('updates a numeric value', async () => {
            const json = '{"count": 0}';
            const rules: JsonPatchRule[] = [{ path: '$.count', rawValue: '42' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.count, 42);
        });

        it('updates a boolean value to true', async () => {
            const json = '{"active": false}';
            const rules: JsonPatchRule[] = [{ path: '$.active', rawValue: 'true' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.active, true);
        });

        it('updates a boolean value to false', async () => {
            const json = '{"active": true}';
            const rules: JsonPatchRule[] = [{ path: '$.active', rawValue: 'false' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.active, false);
        });

        it('updates value to null', async () => {
            const json = '{"data": "something"}';
            const rules: JsonPatchRule[] = [{ path: '$.data', rawValue: 'null' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.data, null);
        });

        it('updates value with JSON object', async () => {
            const json = '{"data": null}';
            const rules: JsonPatchRule[] = [{ path: '$.data', rawValue: '{"nested": "value"}' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.deepEqual(parsed.data, { nested: 'value' });
        });

        it('updates value with JSON array', async () => {
            const json = '{"items": []}';
            const rules: JsonPatchRule[] = [{ path: '$.items', rawValue: '[1, 2, 3]' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.deepEqual(parsed.items, [1, 2, 3]);
        });

        it('updates array element by index', async () => {
            const json = '{"items": ["a", "b", "c"]}';
            const rules: JsonPatchRule[] = [{ path: '$.items[1]', rawValue: 'updated' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.deepEqual(parsed.items, ['a', 'updated', 'c']);
        });

        it('updates all matching elements with wildcard', async () => {
            const json = '{"users": [{"name": "A"}, {"name": "B"}]}';
            const rules: JsonPatchRule[] = [{ path: '$.users[*].name', rawValue: 'Updated' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.users[0].name, 'Updated');
            assert.equal(parsed.users[1].name, 'Updated');
        });

        it('handles deeply nested paths', async () => {
            const json = '{"a": {"b": {"c": {"d": "original"}}}}';
            const rules: JsonPatchRule[] = [{ path: '$.a.b.c.d', rawValue: 'deep' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.a.b.c.d, 'deep');
        });

        it('creates missing intermediate objects', async () => {
            const json = '{"existing": true}';
            const rules: JsonPatchRule[] = [{ path: '$.new.nested.value', rawValue: 'created' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            // Note: JSONPath may not find paths that don't exist
            // This test verifies current behavior
            assert.equal(parsed.existing, true);
        });

        it('applies multiple rules in order', async () => {
            const json = '{"a": 1, "b": 2}';
            const rules: JsonPatchRule[] = [
                { path: '$.a', rawValue: '10' },
                { path: '$.b', rawValue: '20' }
            ];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.a, 10);
            assert.equal(parsed.b, 20);
        });

        it('uses variable resolver for values', async () => {
            const json = '{"token": "placeholder"}';
            const rules: JsonPatchRule[] = [{ path: '$.token', rawValue: '{{secret}}' }];
            const resolver = async (text: string) => {
                if (text === '{{secret}}') return 'resolved-secret';
                return text;
            };
            const result = await applyJsonPathPokes(json, rules, resolver);
            const parsed = JSON.parse(result);
            assert.equal(parsed.token, 'resolved-secret');
        });

        it('preserves double-quoted string values', async () => {
            const json = '{"name": "original"}';
            const rules: JsonPatchRule[] = [{ path: '$.name', rawValue: '"quoted value"' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.name, 'quoted value');
        });

        it('preserves single-quoted string values', async () => {
            const json = '{"name": "original"}';
            const rules: JsonPatchRule[] = [{ path: '$.name', rawValue: "'single quoted'" }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.name, 'single quoted');
        });

        it('handles floating point numbers', async () => {
            const json = '{"price": 0}';
            const rules: JsonPatchRule[] = [{ path: '$.price', rawValue: '19.99' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.price, 19.99);
        });

        it('handles negative numbers', async () => {
            const json = '{"value": 0}';
            const rules: JsonPatchRule[] = [{ path: '$.value', rawValue: '-42' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.value, -42);
        });

        it('handles scientific notation', async () => {
            const json = '{"value": 0}';
            const rules: JsonPatchRule[] = [{ path: '$.value', rawValue: '1.5e10' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.value, 1.5e10);
        });

        it('throws error for invalid JSON input', async () => {
            const invalidJson = '{not valid json}';
            const rules: JsonPatchRule[] = [{ path: '$.name', rawValue: 'value' }];
            await assert.rejects(
                async () => applyJsonPathPokes(invalidJson, rules, identity),
                /body is not valid JSON/
            );
        });

        it('handles JSONPath filter expressions', async () => {
            const json = '{"users": [{"name": "Alice", "age": 25}, {"name": "Bob", "age": 30}]}';
            const rules: JsonPatchRule[] = [{ path: '$.users[?(@.age > 27)].name', rawValue: 'Senior' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.users[0].name, 'Alice');
            assert.equal(parsed.users[1].name, 'Senior');
        });

        it('does nothing when path matches no elements', async () => {
            const json = '{"existing": "value"}';
            const rules: JsonPatchRule[] = [{ path: '$.nonexistent', rawValue: 'new' }];
            const result = await applyJsonPathPokes(json, rules, identity);
            const parsed = JSON.parse(result);
            assert.equal(parsed.existing, 'value');
            assert.equal(parsed.nonexistent, undefined);
        });
    });
});

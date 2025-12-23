import { strict as assert } from 'assert';
import { Readable } from 'stream';
import * as vscode from 'vscode';
import {
    processBodyWithPatching,
    OngoingRequest,
    TemplateOrder
} from '../src/utils/bodyPatchPipeline';

// Helper to create a readable stream from a string
function stringToStream(str: string): Readable {
    const stream = new Readable();
    stream.push(str);
    stream.push(null);
    return stream;
}

// Identity resolver - returns text unchanged
const identity = async (text: string) => text;

// Helper to create a basic request
function createRequest(overrides: Partial<OngoingRequest> = {}): OngoingRequest {
    return {
        url: 'https://example.com',
        method: 'POST',
        headers: {},
        body: undefined,
        ...overrides
    };
}

beforeEach(() => {
    vscode.workspace.__resetConfiguration();
});

describe('bodyPatchPipeline', () => {
    describe('processBodyWithPatching - JSON patching', () => {
        it('patches JSON body when patch header is present', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original", "value": 123}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'Updated');
            assert.equal(parsed.value, 123);
        });

        it('strips patch header after processing', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
        });

        it('handles multiple patch rules in single header', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.a=1;$.b=2;$.c=3'
                },
                body: '{"a": 0, "b": 0, "c": 0}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.a, 1);
            assert.equal(parsed.b, 2);
            assert.equal(parsed.c, 3);
        });

        it('resolves variables in patch values', async () => {
            const resolver = async (text: string) => {
                if (text === '{{token}}') return 'resolved-token';
                return text;
            };
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.token={{token}}'
                },
                body: '{"token": "placeholder"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, resolver);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.token, 'resolved-token');
        });

        it('skips patching when disabled via configuration', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.enableJsonBodyPatching', false);
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'Original');
            // Header should still be stripped
            assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
        });

        it('skips patching for json-patch+json content type', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json-patch+json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'Original');
        });

        it('skips patching when no body is present', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: undefined
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.strictEqual(request.body, undefined);
            assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
        });

        it('skips patching when content-type is not JSON', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'text/plain',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            // Body should remain unchanged
            assert.equal(request.body, '{"name": "Original"}');
        });

        it('handles Stream body input', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=StreamPatched'
                },
                body: stringToStream('{"name": "Original"}')
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'StreamPatched');
        });

        it('uses custom header name from configuration', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.jsonPatchHeaderName', 'X-Custom-Patch');
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-Custom-Patch': '$.name=CustomHeader'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'CustomHeader');
            assert.strictEqual(request.headers['X-Custom-Patch'], undefined);
        });

        it('handles case-insensitive header matching', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'x-restiveclient-jsonpatch': '$.name=LowerCase'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'LowerCase');
        });

        it('patches nested object values', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.user.profile.name=DeepUpdate'
                },
                body: '{"user": {"profile": {"name": "Original", "age": 30}}}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.user.profile.name, 'DeepUpdate');
            assert.equal(parsed.user.profile.age, 30);
        });

        it('patches array elements', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.items[1]=updated'
                },
                body: '{"items": ["a", "b", "c"]}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.deepEqual(parsed.items, ['a', 'updated', 'c']);
        });

        it('handles application/json with charset', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'X-RestiveClient-JsonPatch': '$.name=WithCharset'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'WithCharset');
        });
    });

    describe('processBodyWithPatching - XML patching', () => {
        it('patches XML body when patch header is present', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//name=Updated'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('<name>Updated</name>'));
        });

        it('strips XML patch header after processing', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//name=Updated'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.strictEqual(request.headers['X-RestiveClient-XmlPatch'], undefined);
        });

        it('patches XML attributes', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//user/@status=active'
                },
                body: '<user status="inactive"><name>Test</name></user>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('status="active"'));
        });

        it('handles text/xml content type', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'text/xml',
                    'X-RestiveClient-XmlPatch': '//name=TextXml'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('<name>TextXml</name>'));
        });

        it('skips XML patching for xml-patch+xml content type', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml-patch+xml',
                    'X-RestiveClient-XmlPatch': '//name=Updated'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('<name>Original</name>'));
        });

        it('resolves variables in XML patch values', async () => {
            const resolver = async (text: string) => {
                if (text === '{{value}}') return 'resolved-value';
                return text;
            };
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//token={{value}}'
                },
                body: '<root><token>placeholder</token></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, resolver);

            assert.ok((request.body as string).includes('<token>resolved-value</token>'));
        });

        it('skips XML patching when disabled', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.enableXmlBodyPatching', false);
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//name=Updated'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('<name>Original</name>'));
        });
    });

    describe('processBodyWithPatching - Template ordering', () => {
        it('applies template before patch with TemplateOrder.BeforePatch', async () => {
            const operations: string[] = [];
            const resolver = async (text: string) => {
                operations.push('template');
                return text.replace('{{placeholder}}', 'TemplateValue');
            };
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.patched=true'
                },
                body: '{"name": "{{placeholder}}", "patched": false}'
            });

            await processBodyWithPatching(request, TemplateOrder.BeforePatch, resolver);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'TemplateValue');
            assert.equal(parsed.patched, true);
        });

        it('applies template after patch with TemplateOrder.AfterPatch', async () => {
            const resolver = async (text: string) => {
                return text.replace('{{placeholder}}', 'AfterPatchValue');
            };
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.patched=true'
                },
                body: '{"name": "{{placeholder}}", "patched": false}'
            });

            await processBodyWithPatching(request, TemplateOrder.AfterPatch, resolver);

            const parsed = JSON.parse(request.body as string);
            // Template runs after, so placeholder gets resolved in JSON output
            assert.equal(parsed.patched, true);
        });

        it('skips template processing with TemplateOrder.None', async () => {
            let templateCalled = false;
            const resolver = async (text: string) => {
                templateCalled = true;
                return text;
            };
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Patched'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, resolver);

            // Resolver is only called for patch values, not full body template
            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'Patched');
        });
    });

    describe('processBodyWithPatching - Debug mode', () => {
        it('adds debug header when enabled', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.bodyPatchDebug', true);
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Debug'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const debugHeader = request.headers['X-RestiveClient-Patch-Debug'];
            assert.ok(debugHeader, 'Debug header should be present');
            assert.ok((debugHeader as string).includes('json-patch:applying'));
            assert.ok((debugHeader as string).includes('json-patch:complete'));
        });

        it('does not add debug header when disabled', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.bodyPatchDebug', false);
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=NoDebug'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.strictEqual(request.headers['X-RestiveClient-Patch-Debug'], undefined);
        });

        it('includes template steps in debug output', async () => {
            vscode.workspace.__setConfigurationValue('restive-client.bodyPatchDebug', true);
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Debug'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.BeforePatch, identity);

            const debugHeader = request.headers['X-RestiveClient-Patch-Debug'] as string;
            assert.ok(debugHeader.includes('template-before-patch:start'));
            assert.ok(debugHeader.includes('template-before-patch:complete'));
        });
    });

    describe('processBodyWithPatching - Combined JSON and XML', () => {
        it('only applies JSON patching for JSON content', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=JsonPatched',
                    'X-RestiveClient-XmlPatch': '//name=XmlPatched'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'JsonPatched');
            // Both headers should be stripped
            assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
            assert.strictEqual(request.headers['X-RestiveClient-XmlPatch'], undefined);
        });

        it('only applies XML patching for XML content', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-JsonPatch': '$.name=JsonPatched',
                    'X-RestiveClient-XmlPatch': '//name=XmlPatched'
                },
                body: '<root><name>Original</name></root>'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.ok((request.body as string).includes('<name>XmlPatched</name>'));
            // Both headers should be stripped
            assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
            assert.strictEqual(request.headers['X-RestiveClient-XmlPatch'], undefined);
        });
    });

    describe('processBodyWithPatching - Edge cases', () => {
        it('handles empty patch header value', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': ''
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'Original');
        });

        it('handles invalid JSON gracefully', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{invalid json}'
            });

            await assert.rejects(
                async () => processBodyWithPatching(request, TemplateOrder.None, identity),
                /body is not valid JSON/
            );
        });

        it('handles invalid XML gracefully', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/xml',
                    'X-RestiveClient-XmlPatch': '//name=Updated'
                },
                body: '<invalid xml'
            });

            await assert.rejects(
                async () => processBodyWithPatching(request, TemplateOrder.None, identity),
                /body is not valid XML/
            );
        });

        it('handles Buffer body input for JSON', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'X-RestiveClient-JsonPatch': '$.name=BufferPatched'
                },
                body: Buffer.from('{"name": "Original"}') as any
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.name, 'BufferPatched');
        });

        it('preserves other headers during patching', async () => {
            const request = createRequest({
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer token123',
                    'X-Custom-Header': 'custom-value',
                    'X-RestiveClient-JsonPatch': '$.name=Patched'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            assert.equal(request.headers['Authorization'], 'Bearer token123');
            assert.equal(request.headers['X-Custom-Header'], 'custom-value');
            assert.equal(request.headers['Content-Type'], 'application/json');
        });

        it('handles no content-type header', async () => {
            const request = createRequest({
                headers: {
                    'X-RestiveClient-JsonPatch': '$.name=Updated'
                },
                body: '{"name": "Original"}'
            });

            await processBodyWithPatching(request, TemplateOrder.None, identity);

            // Should skip patching without content-type
            assert.equal(request.body, '{"name": "Original"}');
        });
    });
});

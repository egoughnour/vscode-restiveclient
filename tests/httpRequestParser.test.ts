import { strict as assert } from 'assert';
import { EOL } from 'os';
import * as path from 'path';
import { FormParamEncodingStrategy } from '../src/models/formParamEncodingStrategy';
import type { IRestClientSettings } from '../src/models/configurationSettings';
import { VariableProcessor } from '../src/utils/variableProcessor';
import { HttpRequestParser } from '../src/utils/httpRequestParser';
import * as vscode from 'vscode';
import { convertStreamToString } from '../src/utils/streamUtility';

const baseSettings = {
    defaultHeaders: {},
    formParamEncodingStrategy: FormParamEncodingStrategy.Never,
} as unknown as IRestClientSettings;

const fixturePath = path.join(__dirname, 'fixtures', 'request-body.json');
const macroFixturePath = path.join(__dirname, 'fixtures', 'request-body-macro.json');
const xmlFixturePath = path.join(__dirname, 'fixtures', 'request-body.xml');
const originalProcessRawRequest = VariableProcessor.processRawRequest;

function buildRequestText(patchHeaderValue: string, indicator: string = ''): string {
    const marker = indicator ? `${indicator} ` : ' ';
    return [
        'POST https://example.com',
        'Content-Type: application/json',
        `X-RestiveClient-JsonPatch: ${patchHeaderValue}`,
        '',
        `<${marker}${fixturePath}`
    ].join(EOL);
}

async function bodyToString(body: string | NodeJS.ReadableStream | undefined): Promise<string> {
    if (body === undefined) {
        return '';
    }
    if (typeof body === 'string') {
        return body;
    }
    return convertStreamToString(body as any);
}

beforeEach(() => {
    VariableProcessor.processRawRequest = async (text: string) => text;
    vscode.workspace.__resetConfiguration();
});

after(() => {
    VariableProcessor.processRawRequest = originalProcessRawRequest;
});

describe('HttpRequestParser JSON body patching', () => {
    it('applies JSON pokes to file-based request bodies', async () => {
        const requestText = buildRequestText('$.user.name=Patched Name');
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        assert.equal(typeof request.body, 'string', 'body should be materialized into text for patching');
        const parsed = JSON.parse(request.body as string);
        assert.equal(parsed.user.name, 'Patched Name');
        assert.equal(parsed.user.token, 'initial-token');
        assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
    });

    it('resolves variables while patching file-based bodies', async () => {
        VariableProcessor.processRawRequest = async (text: string) => {
            if (text === '{{runtime-token}}') {
                return 'resolved-token';
            }
            return text;
        };
        const requestText = buildRequestText('$.user.token={{runtime-token}}');
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        const parsed = JSON.parse(request.body as string);
        assert.equal(parsed.user.token, 'resolved-token');
        assert.equal(parsed.user.name, 'Original');
    });

    it('applies JSON pokes after template substitution when using "@j"', async () => {
        VariableProcessor.processRawRequest = async (text: string) => text.replace('{{name}}', 'Templated');
        vscode.workspace.__setConfigurationValue('restive-client.bodyPatchDebug', true);
        const requestText = buildRequestText('$.user.name=Patched Name', '@j');
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        const parsed = JSON.parse(request.body as string);
        assert.equal(parsed.user.name, 'Patched Name');
        assert.ok((request.headers['X-RestiveClient-Patch-Debug'] as string).startsWith('template-before-patch'), 'template should run before patch');
    });

    it('applies JSON pokes before template substitution when using "j@"', async () => {
        const callOrder: string[] = [];
        VariableProcessor.processRawRequest = async (text: string) => {
            callOrder.push('template');
            return text.replace('{{token}}', 'TemplatedToken');
        };
        vscode.workspace.__setConfigurationValue('restive-client.bodyPatchDebug', true);
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            'X-RestiveClient-JsonPatch: $.user.token={{token}}',
            '',
            `<j@ ${macroFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        const parsed = JSON.parse(request.body as string);
        assert.equal(parsed.user.token, 'TemplatedToken');
        assert.ok((request.headers['X-RestiveClient-Patch-Debug'] as string).includes('json-patch:applying'), 'patch should run');
        assert.ok((request.headers['X-RestiveClient-Patch-Debug'] as string).includes('template-after-patch'), 'template should run after patch');
        assert.ok(callOrder.length > 0, 'template should execute');
    });

    it('skips JSON patching for json patch content types', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json-patch+json',
            'X-RestiveClient-JsonPatch: $.user.name=Patched Name',
            '',
            `< ${fixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        const bodyText = await bodyToString(request.body as any);
        assert.equal(JSON.parse(bodyText).user.name, 'Original');
        assert.strictEqual(request.headers['X-RestiveClient-JsonPatch'], undefined);
    });

    it('leaves template markers untouched when using "<."', async () => {
        VariableProcessor.processRawRequest = async (text: string) => text.replace('{{name}}', 'Templated');
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            'X-RestiveClient-JsonPatch: $.user.token=patched',
            '',
            `<. ${macroFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        const parsed = JSON.parse(request.body as string);
        assert.equal(parsed.user.name, '{{name}}');
        assert.equal(parsed.user.token, 'patched');
    });
});

describe('HttpRequestParser XML body patching', () => {
    it('applies XPath pokes to XML bodies', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/xml',
            'X-RestiveClient-XmlPatch: //user/name=NewName;//user/@status=active',
            '',
            `<x@ ${xmlFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        assert.equal(typeof request.body, 'string');
        const body = request.body as string;
        assert.ok(body.includes('<name>NewName</name>'));
        assert.ok(body.includes('status="active"'));
        assert.strictEqual(request.headers['X-RestiveClient-XmlPatch'], undefined);
    });

    it('skips XPath patching for xml patch content types', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/xml-patch+xml',
            'X-RestiveClient-XmlPatch: //user/name=NewName',
            '',
            `< ${xmlFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();
        const body = await bodyToString(request.body as any);
        assert.ok(body.includes('<name>Original</name>'));
        assert.strictEqual(request.headers['X-RestiveClient-XmlPatch'], undefined);
    });
});

// Regression tests for rawBody field (used by code snippet generation)
describe('HttpRequestParser rawBody for code generation', () => {
    it('rawBody contains resolved file content, not file indicator syntax', async () => {
        // This is a regression test: rawBody should contain actual JSON content,
        // not the file indicator like "< /path/to/file.json"
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            '',
            `< ${fixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // rawBody should NOT contain the file indicator syntax
        assert.ok(!request.rawBody?.includes('<'), 'rawBody should not contain file indicator "<"');
        assert.ok(!request.rawBody?.includes(fixturePath), 'rawBody should not contain file path');
        
        // rawBody SHOULD contain actual JSON content
        assert.ok(request.rawBody?.includes('"user"'), 'rawBody should contain actual JSON content');
        const parsed = JSON.parse(request.rawBody!);
        assert.equal(parsed.user.name, 'Original');
    });

    it('rawBody contains patched content after body patching', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            'X-RestiveClient-JsonPatch: $.user.name=CodeGenName',
            '',
            `<@ ${fixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // rawBody should contain the patched content (same as body after patching)
        const parsed = JSON.parse(request.rawBody!);
        assert.equal(parsed.user.name, 'CodeGenName', 'rawBody should reflect patched values');
    });

    it('rawBody contains resolved XML content from file', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/xml',
            '',
            `< ${xmlFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // rawBody should NOT contain the file indicator syntax
        assert.ok(!request.rawBody?.includes('<x@'), 'rawBody should not contain file indicator');
        assert.ok(!request.rawBody?.includes(xmlFixturePath), 'rawBody should not contain file path');
        
        // rawBody SHOULD contain actual XML content
        assert.ok(request.rawBody?.includes('<user'), 'rawBody should contain actual XML content');
        assert.ok(request.rawBody?.includes('<name>Original</name>'), 'rawBody should contain XML element');
    });

    it('rawBody contains template-resolved content', async () => {
        VariableProcessor.processRawRequest = async (text: string) => 
            text.replace('{{name}}', 'ResolvedName');
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            '',
            `<@ ${macroFixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // rawBody should contain resolved template values
        const parsed = JSON.parse(request.rawBody!);
        assert.equal(parsed.user.name, 'ResolvedName', 'rawBody should have resolved template variables');
    });

    it('rawBody equals body when body is a string', async () => {
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            'X-RestiveClient-JsonPatch: $.name=Test',
            '',
            `<@ ${fixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // When body is a string (after patching), rawBody should match
        assert.equal(typeof request.body, 'string');
        assert.equal(request.rawBody, request.body, 'rawBody should equal body when body is string');
    });

    it('rawBody is available even when body remains a stream', async () => {
        // When using plain "< " without patching, body might be a stream for efficiency
        // but rawBody should still be available as a string for code generation
        vscode.workspace.__setConfigurationValue('restive-client.enableJsonBodyPatching', false);
        const requestText = [
            'POST https://example.com',
            'Content-Type: application/json',
            '',
            `< ${fixturePath}`
        ].join(EOL);
        const parser = new HttpRequestParser(requestText, baseSettings);

        const request = await parser.parseHttpRequest();

        // rawBody should be a string with resolved content regardless of body type
        assert.equal(typeof request.rawBody, 'string', 'rawBody should always be a string');
        assert.ok(!request.rawBody?.startsWith('<'), 'rawBody should not start with file indicator');
        const parsed = JSON.parse(request.rawBody!);
        assert.equal(parsed.user.name, 'Original');
    });
});

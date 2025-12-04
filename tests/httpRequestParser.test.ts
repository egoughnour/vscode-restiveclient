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

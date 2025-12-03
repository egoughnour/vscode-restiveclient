import { strict as assert } from 'assert';
import { EOL } from 'os';
import * as path from 'path';
import { FormParamEncodingStrategy } from '../src/models/formParamEncodingStrategy';
import type { IRestClientSettings } from '../src/models/configurationSettings';
import { VariableProcessor } from '../src/utils/variableProcessor';
import { HttpRequestParser } from '../src/utils/httpRequestParser';

const baseSettings = {
    defaultHeaders: {},
    formParamEncodingStrategy: FormParamEncodingStrategy.Never,
} as unknown as IRestClientSettings;

const fixturePath = path.join(__dirname, 'fixtures', 'request-body.json');

function buildRequestText(patchHeaderValue: string): string {
    return [
        'POST https://example.com',
        'Content-Type: application/json',
        `X-RestiveClient-JsonPatch: ${patchHeaderValue}`,
        '',
        `< ${fixturePath}`
    ].join(EOL);
}

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
        const originalProcessRawRequest = VariableProcessor.processRawRequest;
        VariableProcessor.processRawRequest = async (text: string) => {
            if (text === '{{runtime-token}}') {
                return 'resolved-token';
            }
            return text;
        };

        try {
            const requestText = buildRequestText('$.user.token={{runtime-token}}');
            const parser = new HttpRequestParser(requestText, baseSettings);

            const request = await parser.parseHttpRequest();

            const parsed = JSON.parse(request.body as string);
            assert.equal(parsed.user.token, 'resolved-token');
            assert.equal(parsed.user.name, 'Original');
        } finally {
            VariableProcessor.processRawRequest = originalProcessRawRequest;
        }
    });
});

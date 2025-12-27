import { strict as assert } from 'assert';
import { IRGenerator, parseHttpFileToIR, parseRequestToIR } from '../src/utils/irGenerator';
import { OperationIR, HttpFileIR, InputBinding, OutputBinding } from '../src/utils/operationIR';

describe('IRGenerator', () => {
    describe('parseHttpFile', () => {
        it('parses a simple named request', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations.length, 1);
            assert.equal(result.operations[0].name, 'getUsers');
            assert.equal(result.operations[0].method, 'GET');
            assert.equal(result.operations[0].urlTemplate, 'https://api.example.com/users');
        });

        it('ignores requests without @name', async () => {
            const content = `
GET https://api.example.com/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations.length, 0);
        });

        it('parses multiple request blocks separated by ###', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users

###

# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations.length, 2);
            assert.equal(result.operations[0].name, 'getUsers');
            assert.equal(result.operations[1].name, 'createUser');
        });

        it('extracts file-level variables', async () => {
            const content = `
@baseUrl = https://api.example.com
@apiKey = secret123

# @name getUsers
GET {{baseUrl}}/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.fileVariables['baseUrl'], 'https://api.example.com');
            assert.equal(result.fileVariables['apiKey'], 'secret123');
        });

        it('parses request with headers', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
Authorization: Bearer token123
Accept: application/json
`;
            const result = await parseHttpFileToIR(content);
            const op = result.operations[0];
            assert.equal(op.headers['authorization'], 'Bearer token123');
            assert.equal(op.headers['accept'], 'application/json');
        });

        it('parses request with inline body', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John", "email": "john@example.com"}
`;
            const result = await parseHttpFileToIR(content);
            const op = result.operations[0];
            assert.equal(op.body.kind, 'inline');
            assert.equal(op.body.mediaType, 'application/json');
            assert.ok(op.body.rawBodyTemplate?.includes('John'));
        });

        it('handles query string continuation lines', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users
    ?name=John
    &limit=10
`;
            const result = await parseHttpFileToIR(content);
            const op = result.operations[0];
            assert.ok(op.urlTemplate.includes('?name=John'));
            assert.ok(op.urlTemplate.includes('&limit=10'));
        });
    });

    describe('parseRequest', () => {
        it('parses a single request with provided name', async () => {
            const requestText = `
GET https://api.example.com/users
Authorization: Bearer token
`;
            const result = await parseRequestToIR(requestText, 'myRequest');
            assert.ok(result);
            assert.equal(result.name, 'myRequest');
            assert.equal(result.method, 'GET');
        });

        it('returns null for request without name', async () => {
            const requestText = `
GET https://api.example.com/users
`;
            const result = await parseRequestToIR(requestText, '');
            assert.equal(result, null);
        });
    });

    describe('HTTP methods', () => {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

        for (const method of methods) {
            it(`parses ${method} method`, async () => {
                const content = `
# @name test
${method} https://api.example.com/resource
`;
                const result = await parseHttpFileToIR(content);
                assert.equal(result.operations[0].method, method);
            });
        }

        it('defaults to GET when no method specified', async () => {
            const content = `
# @name test
https://api.example.com/resource
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].method, 'GET');
        });

        it('strips HTTP version from URL', async () => {
            const content = `
# @name test
GET https://api.example.com/resource HTTP/1.1
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].urlTemplate, 'https://api.example.com/resource');
        });
    });

    describe('input binding extraction', () => {
        it('extracts URL path variables', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const userIdInput = inputs.find(i => i.name === 'userId');
            assert.ok(userIdInput);
            assert.equal(userIdInput.source, 'path');
            assert.equal(userIdInput.required, true);
        });

        it('extracts URL query variables', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{searchName}}&limit={{limit}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const searchNameInput = inputs.find(i => i.name === 'searchName');
            const limitInput = inputs.find(i => i.name === 'limit');
            assert.ok(searchNameInput);
            assert.ok(limitInput);
        });

        it('extracts header variables', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer {{token}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const tokenInput = inputs.find(i => i.name === 'token');
            assert.ok(tokenInput);
            assert.equal(tokenInput.source, 'header');
        });

        it('extracts body variables', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "{{userName}}", "email": "{{userEmail}}"}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const nameInput = inputs.find(i => i.name === 'userName');
            const emailInput = inputs.find(i => i.name === 'userEmail');
            assert.ok(nameInput);
            assert.ok(emailInput);
            assert.equal(nameInput.source, 'body');
        });

        it('identifies system variables', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"timestamp": "{{$timestamp}}", "id": "{{$guid}}"}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const timestampInput = inputs.find(i => i.rawExpression.includes('$timestamp'));
            const guidInput = inputs.find(i => i.rawExpression.includes('$guid'));
            assert.ok(timestampInput);
            assert.ok(guidInput);
            assert.equal(timestampInput.source, 'system');
            assert.equal(guidInput.source, 'system');
            assert.equal(timestampInput.required, false);
        });

        it('identifies config variables from $processEnv', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer {{$processEnv API_KEY}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const configInput = inputs.find(i => i.source === 'config');
            assert.ok(configInput);
            assert.equal(configInput.name, 'API_KEY');
            assert.equal(configInput.required, false);
        });

        it('identifies config variables from $dotenv', async () => {
            const content = `
# @name test
GET https://api.example.com/users
X-Secret: {{$dotenv SECRET_KEY}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const configInput = inputs.find(i => i.source === 'config');
            assert.ok(configInput);
            assert.equal(configInput.name, 'SECRET_KEY');
        });

        it('does not include request variable references as inputs', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer {{login.response.body.$.token}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            // Should not have any inputs since the only variable is a request reference
            const tokenInput = inputs.find(i => i.name === 'token');
            assert.ok(!tokenInput);
        });

        it('deduplicates variables used multiple times', async () => {
            const content = `
# @name test
GET https://api.example.com/users/{{userId}}/posts/{{userId}}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const userIdInputs = inputs.filter(i => i.name === 'userId');
            assert.equal(userIdInputs.length, 1);
        });
    });

    describe('dependency extraction', () => {
        it('extracts dependencies from request variable references', async () => {
            const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin", "password": "secret"}

###

# @name getUsers
GET https://api.example.com/users
Authorization: Bearer {{login.response.body.$.token}}
`;
            const result = await parseHttpFileToIR(content);
            const getUsers = result.operations.find(o => o.name === 'getUsers');
            assert.ok(getUsers);
            assert.ok(getUsers.dependencies.includes('login'));
        });

        it('extracts multiple dependencies', async () => {
            const content = `
# @name test
GET https://api.example.com/data
Authorization: Bearer {{auth.response.body.$.token}}
X-Session: {{session.response.headers.X-Session-Id}}
`;
            const result = await parseHttpFileToIR(content);
            const op = result.operations[0];
            assert.ok(op.dependencies.includes('auth'));
            assert.ok(op.dependencies.includes('session'));
        });
    });

    describe('metadata extraction', () => {
        it('extracts @note metadata', async () => {
            const content = `
# @name dangerousOp
# @note
DELETE https://api.example.com/users/all
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].metadata.note, true);
        });

        it('extracts @no-redirect metadata', async () => {
            const content = `
# @name test
# @no-redirect
GET https://api.example.com/redirect
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].metadata.noRedirect, true);
        });

        it('extracts @no-cookie-jar metadata', async () => {
            const content = `
# @name test
# @no-cookie-jar
GET https://api.example.com/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].metadata.noCookieJar, true);
        });

        it('extracts @prompt metadata', async () => {
            const content = `
# @name login
# @prompt username Enter your username
# @prompt password Enter your password
POST https://api.example.com/login
Content-Type: application/json

{"username": "{{username}}", "password": "{{password}}"}
`;
            const result = await parseHttpFileToIR(content);
            const prompts = result.operations[0].metadata.prompts;
            assert.ok(prompts);
            assert.equal(prompts.length, 2);
            assert.equal(prompts[0].name, 'username');
            assert.equal(prompts[0].description, 'Enter your username');
        });
    });

    describe('comment block extraction', () => {
        it('extracts @block sections from comments', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "Alice"}

# @block createUser.service
# Create a user and return the new id
# Ensure validation errors are handled
# @end
`;
            const result = await parseHttpFileToIR(content);
            const blocks = result.operations[0].commentBlocks;
            assert.ok(blocks);
            assert.equal(blocks?.length, 1);
            assert.equal(blocks?.[0].name, 'createUser.service');
            assert.ok(blocks?.[0].content.includes('Create a user'));
        });
    });

    describe('patch rule extraction', () => {
        it('extracts JSON patch rules from header', async () => {
            const content = `
# @name updateUser
PATCH https://api.example.com/users/1
Content-Type: application/json
X-RestiveClient-JsonPatch: $.name={{newName}};$.active=true

{"name": "placeholder", "active": false}
`;
            const result = await parseHttpFileToIR(content);
            const op = result.operations[0];
            assert.ok(op.body.patch?.jsonRules);
            assert.equal(op.body.patch.jsonRules.length, 2);
            assert.equal(op.body.patch.jsonRules[0].path, '$.name');
            assert.equal(op.body.patch.jsonRules[0].rawValue, '{{newName}}');
        });

        it('extracts variables from patch rule values as inputs', async () => {
            const content = `
# @name updateUser
PATCH https://api.example.com/users/1
Content-Type: application/json
X-RestiveClient-JsonPatch: $.name={{newName}};$.email={{newEmail}}

{"name": "", "email": ""}
`;
            const result = await parseHttpFileToIR(content);
            const inputs = result.operations[0].inputs;
            const nameInput = inputs.find(i => i.name === 'newName');
            const emailInput = inputs.find(i => i.name === 'newEmail');
            assert.ok(nameInput);
            assert.ok(emailInput);
        });

        it('excludes patch directive headers from output headers', async () => {
            const content = `
# @name test
PATCH https://api.example.com/users/1
Content-Type: application/json
X-RestiveClient-JsonPatch: $.name=test

{"name": ""}
`;
            const result = await parseHttpFileToIR(content);
            const headers = result.operations[0].headers;
            assert.ok(!('x-restiveclient-jsonpatch' in headers));
            assert.ok('content-type' in headers);
        });
    });

    describe('body specification', () => {
        it('sets body kind to none when no body', async () => {
            const content = `
# @name test
GET https://api.example.com/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].body.kind, 'none');
        });

        it('sets body kind to inline for inline body', async () => {
            const content = `
# @name test
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].body.kind, 'inline');
        });

        it('sets body kind to file for file reference', async () => {
            const content = `
# @name test
POST https://api.example.com/users
Content-Type: application/json

< ./data/user.json
`;
            const result = await parseHttpFileToIR(content, { loadFileContents: false });
            assert.equal(result.operations[0].body.kind, 'file');
            assert.equal(result.operations[0].body.fileRef, './data/user.json');
        });

        it('preserves media type from Content-Type header', async () => {
            const content = `
# @name test
POST https://api.example.com/users
Content-Type: application/xml

<user><name>John</name></user>
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations[0].body.mediaType, 'application/xml');
        });
    });

    describe('body pipeline', () => {
        it('creates template stage for inline body', async () => {
            const content = `
# @name test
POST https://api.example.com/users
Content-Type: application/json

{"name": "{{name}}"}
`;
            const result = await parseHttpFileToIR(content);
            const pipeline = result.operations[0].body.pipeline;
            assert.ok(pipeline.some(s => s.type === 'template'));
        });

        it('includes jsonPatch stage when rules present', async () => {
            const content = `
# @name test
PATCH https://api.example.com/users/1
Content-Type: application/json
X-RestiveClient-JsonPatch: $.name=newName

{"name": "old"}
`;
            const result = await parseHttpFileToIR(content);
            const pipeline = result.operations[0].body.pipeline;
            assert.ok(pipeline.some(s => s.type === 'jsonPatch'));
        });

        it('includes xmlPatch stage when rules present', async () => {
            const content = `
# @name test
PUT https://api.example.com/users/1
Content-Type: application/xml
X-RestiveClient-XmlPatch: //name=newName

<user><name>old</name></user>
`;
            const result = await parseHttpFileToIR(content);
            const pipeline = result.operations[0].body.pipeline;
            assert.ok(pipeline.some(s => s.type === 'xmlPatch'));
        });
    });

    describe('output binding extraction', () => {
        it('extracts outputs from block-local variable assignments', async () => {
            const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin", "password": "secret"}

@token = {{login.response.body.$.token}}
@userId = {{login.response.body.$.user.id}}
`;
            const result = await parseHttpFileToIR(content);
            const outputs = result.operations[0].outputs;
            assert.equal(outputs.length, 2);

            const tokenOutput = outputs.find(o => o.name === 'token');
            assert.ok(tokenOutput);
            assert.equal(tokenOutput.source, 'body');

            const userIdOutput = outputs.find(o => o.name === 'userId');
            assert.ok(userIdOutput);
        });

        it('extracts header outputs', async () => {
            const content = `
# @name test
GET https://api.example.com/auth

@sessionId = {{test.response.headers.X-Session-Id}}
`;
            const result = await parseHttpFileToIR(content);
            const outputs = result.operations[0].outputs;
            const sessionOutput = outputs.find(o => o.name === 'sessionId');
            assert.ok(sessionOutput);
            assert.equal(sessionOutput.source, 'headers');
        });

        it('ignores outputs referencing other operations', async () => {
            const content = `
# @name first
GET https://api.example.com/first

###

# @name second
GET https://api.example.com/second

@data = {{first.response.body.$.data}}
`;
            const result = await parseHttpFileToIR(content);
            const secondOp = result.operations.find(o => o.name === 'second');
            assert.ok(secondOp);
            // This should not be an output of 'second' since it references 'first'
            assert.equal(secondOp.outputs.length, 0);
        });
    });

    describe('edge cases', () => {
        it('handles empty content', async () => {
            const result = await parseHttpFileToIR('');
            assert.equal(result.operations.length, 0);
        });

        it('handles content with only comments', async () => {
            const content = `
# This is a comment
// Another comment
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations.length, 0);
        });

        it('handles malformed requests gracefully', async () => {
            const content = `
# @name broken
# missing actual request line
`;
            const result = await parseHttpFileToIR(content);
            // Should either skip or handle gracefully
            assert.ok(result.warnings.length === 0 || result.operations.length === 0);
        });

        it('handles requests with // style comments', async () => {
            const content = `
// @name test
GET https://api.example.com/users
`;
            const result = await parseHttpFileToIR(content);
            assert.equal(result.operations.length, 1);
            assert.equal(result.operations[0].name, 'test');
        });

        it('preserves raw text for debugging', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer token
`;
            const result = await parseHttpFileToIR(content);
            assert.ok(result.operations[0].rawText);
            assert.ok(result.operations[0].rawText?.includes('Authorization'));
        });
    });
});

describe('IRGenerator class', () => {
    it('accepts custom options', async () => {
        const generator = new IRGenerator({
            basePath: '/custom/path',
            loadFileContents: false,
            jsonPatchHeaderName: 'x-custom-json-patch',
        });

        const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json
X-Custom-Json-Patch: $.name=test

{"name": ""}
`;
        const result = await generator.parseHttpFile(content);
        const op = result.operations[0];
        assert.ok(op.body.patch?.jsonRules);
        assert.equal(op.body.patch.jsonRules[0].path, '$.name');
    });
});

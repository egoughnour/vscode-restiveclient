import { strict as assert } from 'assert';
import {
    ExpressGenerator,
    generateExpressApp,
    generateExpressRoutes,
    generateImplementationStubs,
    GeneratedExpressApp,
} from '../src/utils/expressGenerator';
import { parseHttpFileToIR } from '../src/utils/irGenerator';
import { HttpFileIR } from '../src/utils/operationIR';

describe('ExpressGenerator', () => {
    describe('basic generation', () => {
        it('generates valid Express code', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.fullContent);
            assert.ok(result.fullContent.includes('function getUsersHandler'));
            assert.ok(result.fullContent.includes("router.get('/users'"));
        });

        it('generates TypeScript by default', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.fullContent.includes(': Request'));
            assert.ok(result.fullContent.includes(': Response'));
            assert.ok(result.fullContent.includes('export '));
        });

        it('can generate JavaScript', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { typescript: false });

            assert.ok(!result.fullContent.includes(': Request'));
            assert.ok(result.fullContent.includes("const express = require('express')"));
            assert.ok(result.fullContent.includes('module.exports'));
        });
    });

    describe('path extraction', () => {
        it('extracts path from full URL', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes("'/users'"));
        });

        it('strips {{baseUrl}} from path', async () => {
            const content = `
# @name getUsers
GET {{baseUrl}}/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes("'/users'"));
            assert.ok(!result.routes.includes('baseUrl'));
        });

        it('converts {{variable}} to :variable', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes("'/users/:userId'"));
        });

        it('strips query string from path', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{name}}&limit={{limit}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes("'/users'"));
            assert.ok(!result.routes.includes('?'));
        });

        it('applies base path prefix', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { basePath: '/api/v1' });

            assert.ok(result.routes.includes("'/api/v1/users'"));
        });
    });

    describe('HTTP methods', () => {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

        for (const method of methods) {
            it(`generates ${method} route`, async () => {
                const content = `
# @name test
${method} https://api.example.com/resource
`;
                const ir = await parseHttpFileToIR(content);
                const result = generateExpressApp(ir);

                assert.ok(result.routes.includes(`router.${method.toLowerCase()}`));
            });
        }
    });

    describe('handler generation', () => {
        it('generates async handlers by default', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('async function'));
        });

        it('can generate sync handlers', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { asyncHandlers: false });

            assert.ok(!result.handlers.includes('async function'));
            assert.ok(result.handlers.includes('function getUsersHandler'));
        });

        it('generates error handling by default', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('try {'));
            assert.ok(result.handlers.includes('catch (error)'));
            assert.ok(result.handlers.includes('next(error)'));
        });

        it('can skip error handling', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { generateErrorHandling: false });

            assert.ok(!result.handlers.includes('try {'));
            assert.ok(!result.handlers.includes('catch'));
        });

        it('generates JSDoc comments by default', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('/**'));
            assert.ok(result.handlers.includes('* Handler for'));
        });
    });

    describe('parameter extraction', () => {
        it('extracts path parameters', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('const { userId } = req.params'));
        });

        it('extracts query parameters', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{name}}&limit={{limit}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('const { name, limit } = req.query'));
        });

        it('extracts header parameters', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer {{token}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            // Header variables use the variable name, extracted via req.get
            assert.ok(result.handlers.includes("req.get('token')"));
        });

        it('extracts request body for POST', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('const body = req.body'));
        });

        it('does not extract body for GET', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(!result.handlers.includes('const body = req.body'));
        });
    });

    describe('validation generation', () => {
        it('generates validation for required path params', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('if (!userId)'));
            assert.ok(result.handlers.includes("'Missing required parameter: userId'"));
        });

        it('generates validation for required body', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('if (!body'));
            assert.ok(result.handlers.includes("'Request body is required'"));
        });

        it('can skip validation', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { generateValidation: false });

            assert.ok(!result.handlers.includes('Missing required'));
        });
    });

    describe('TypeScript types', () => {
        it('generates Params interface for path params', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface GetUserParams'));
            assert.ok(result.types.includes('userId: string'));
        });

        it('generates Query interface for query params', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{name}}&limit={{limit}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface SearchUsersQuery'));
            assert.ok(result.types.includes('name'));
            assert.ok(result.types.includes('limit'));
        });

        it('generates Body interface for request body', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface CreateUserBody'));
        });

        it('generates Response interface', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface GetUsersResponse'));
        });

        it('generates Response interface based on outputs', async () => {
            const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin", "password": "secret"}

@token = {{login.response.body.$.token}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface LoginResponse'));
            assert.ok(result.types.includes('token: unknown'));
        });

        it('generates combined Request interface', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}?include={{include}}
Authorization: Bearer {{token}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('export interface GetUserRequest'));
            assert.ok(result.types.includes('params: GetUserParams'));
            assert.ok(result.types.includes('query: GetUserQuery'));
        });
    });

    describe('implementation hooks', () => {
        it('generates implementation hook imports', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.imports.includes('getUsersImpl'));
            assert.ok(result.imports.includes("from './impl'"));
        });

        it('generates implementation call', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('const result = await getUsersImpl(request)'));
        });

        it('generates implementation interfaces', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.implInterfaces.includes('export type GetUsersImplFn'));
        });

        it('can skip implementation hooks', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { generateImplementationHooks: false });

            assert.ok(!result.imports.includes('getUsersImpl'));
            assert.ok(result.handlers.includes('TODO: Implement business logic'));
        });

        it('uses custom impl module path', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { implModulePath: './services/impl' });

            assert.ok(result.imports.includes("from './services/impl'"));
        });
    });

    describe('response generation', () => {
        it('generates simple json response for operations with outputs', async () => {
            const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin"}

@token = {{login.response.body.$.token}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('res.json(result)'));
        });

        it('generates envelope response for operations without outputs', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('res.status(result.status)'));
            assert.ok(result.handlers.includes('res.set(result.headers)'));
        });
    });

    describe('route registration', () => {
        it('generates router by default', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes('const router = Router()'));
            assert.ok(result.routes.includes('router.get'));
        });

        it('can generate app-style routes', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir, { routeStyle: 'app' });

            assert.ok(!result.routes.includes('const router'));
            assert.ok(result.routes.includes('app.get'));
        });

        it('includes route comments', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.routes.includes('// GET /users - getUsers'));
        });
    });

    describe('multiple operations', () => {
        it('generates handlers for multiple operations', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users

###

# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('function getUsersHandler'));
            assert.ok(result.handlers.includes('function createUserHandler'));
            assert.ok(result.routes.includes("router.get('/users'"));
            assert.ok(result.routes.includes("router.post('/users'"));
        });

        it('generates types for all operations', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users

###

# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.types.includes('GetUsersResponse'));
            assert.ok(result.types.includes('GetUserParams'));
            assert.ok(result.types.includes('GetUserResponse'));
        });
    });

    describe('edge cases', () => {
        it('handles empty IR', async () => {
            const ir: HttpFileIR = {
                operations: [],
                fileVariables: {},
                warnings: [],
            };

            const result = generateExpressApp(ir);

            assert.ok(result.fullContent);
            assert.ok(result.routes.includes('const router = Router()'));
        });

        it('handles operations without parameters', async () => {
            const content = `
# @name healthCheck
GET https://api.example.com/health
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            assert.ok(result.handlers.includes('function healthCheckHandler'));
            // Should not have parameter extraction for params/query
            assert.ok(!result.handlers.includes('const { } = req.params'));
        });

        it('handles header names with hyphens', async () => {
            const content = `
# @name test
GET https://api.example.com/test
X-Custom-Header: {{customHeader}}
`;
            const ir = await parseHttpFileToIR(content);
            const result = generateExpressApp(ir);

            // Should convert to valid identifier
            assert.ok(result.handlers.includes('x_custom_header') || result.handlers.includes('customHeader'));
        });
    });
});

describe('generateImplementationStubs', () => {
    it('generates implementation stubs', async () => {
        const content = `
# @name getUsers
GET https://api.example.com/users

###

# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
        const ir = await parseHttpFileToIR(content);
        const stubs = generateImplementationStubs(ir);

        assert.ok(stubs.includes('export async function getUsersImpl'));
        assert.ok(stubs.includes('export async function createUserImpl'));
        assert.ok(stubs.includes('TODO: Implement'));
    });

    it('includes response structure based on outputs', async () => {
        const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin"}

@token = {{login.response.body.$.token}}
`;
        const ir = await parseHttpFileToIR(content);
        const stubs = generateImplementationStubs(ir);

        assert.ok(stubs.includes('token: undefined'));
    });

    it('generates envelope response for operations without outputs', async () => {
        const content = `
# @name getUsers
GET https://api.example.com/users
`;
        const ir = await parseHttpFileToIR(content);
        const stubs = generateImplementationStubs(ir);

        assert.ok(stubs.includes('status: 200'));
        assert.ok(stubs.includes('headers: {}'));
        assert.ok(stubs.includes('body:'));
    });

    it('can generate JavaScript stubs', async () => {
        const content = `
# @name getUsers
GET https://api.example.com/users
`;
        const ir = await parseHttpFileToIR(content);
        const stubs = generateImplementationStubs(ir, { typescript: false });

        assert.ok(!stubs.includes(': Promise<'));
        assert.ok(stubs.includes('export async function getUsersImpl'));
    });
});

describe('ExpressGenerator class', () => {
    it('accepts custom options', async () => {
        const generator = new ExpressGenerator({
            typescript: true,
            asyncHandlers: true,
            generateValidation: false,
            basePath: '/api',
        });

        const content = `
# @name getUsers
GET https://api.example.com/users
`;
        const ir = await parseHttpFileToIR(content);
        const result = generator.generate(ir);

        assert.ok(result.routes.includes("'/api/users'"));
        assert.ok(!result.handlers.includes('Missing required'));
    });

    it('can generate single route', async () => {
        const generator = new ExpressGenerator();

        const content = `
# @name getUsers
GET https://api.example.com/users
`;
        const ir = await parseHttpFileToIR(content);
        const route = generator.generateRoute(ir.operations[0]);

        assert.equal(route.operationName, 'getUsers');
        assert.equal(route.method, 'get');
        assert.equal(route.path, '/users');
        assert.ok(route.handlerCode.includes('getUsersHandler'));
    });
});

describe('generateExpressRoutes', () => {
    it('returns full content string', async () => {
        const content = `
# @name getUsers
GET https://api.example.com/users
`;
        const ir = await parseHttpFileToIR(content);
        const code = generateExpressRoutes(ir);

        assert.ok(typeof code === 'string');
        assert.ok(code.includes('import'));
        assert.ok(code.includes('function getUsersHandler'));
        assert.ok(code.includes('router.get'));
    });
});

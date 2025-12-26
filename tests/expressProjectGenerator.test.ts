/**
 * Tests for Express Project Generator
 */

import { strict as assert } from 'assert';
import { ExpressProjectGenerator, generateExpressProject, GeneratedProject, ProjectGeneratorOptions } from '../src/utils/expressProjectGenerator';
import { HttpFileIR, OperationIR, InputBinding, OutputBinding, BodySpec } from '../src/utils/operationIR';
import { parseHttpFileToIR } from '../src/utils/irGenerator';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOperation(overrides: Partial<OperationIR> = {}): OperationIR {
    const defaultBody: BodySpec = {
        kind: 'none',
        pipeline: [],
    };

    return {
        name: 'getUser',
        method: 'GET',
        urlTemplate: '{{baseUrl}}/users/{{id}}',
        inputs: [
            { name: 'id', source: 'path', rawExpression: '{{id}}', required: true },
        ],
        outputs: [],
        headers: {},
        body: defaultBody,
        dependencies: [],
        metadata: {},
        ...overrides,
    };
}

function createTestFileIR(operations: OperationIR[] = []): HttpFileIR {
    return {
        operations: operations.length > 0 ? operations : [createTestOperation()],
        fileVariables: {},
        warnings: [],
    };
}

function createDefaultOptions(overrides: Partial<ProjectGeneratorOptions> = {}): ProjectGeneratorOptions {
    return {
        projectName: 'test-api',
        description: 'Test API',
        ...overrides,
    };
}

function findFile(project: GeneratedProject, pathPattern: string | RegExp): string | undefined {
    const file = project.files.find(f =>
        typeof pathPattern === 'string'
            ? f.path === pathPattern
            : pathPattern.test(f.path)
    );
    return file?.content;
}

// ============================================================================
// Basic Generation Tests
// ============================================================================

describe('ExpressProjectGenerator', () => {
    describe('constructor', () => {
        it('should set default options', () => {
            const generator = new ExpressProjectGenerator({ projectName: 'my-api' });
            const project = generator.generate(createTestFileIR());

            // Check defaults are applied via generated files
            const pkgJson = findFile(project, 'package.json');
            assert.ok(pkgJson, 'package.json should be defined');
            const pkg = JSON.parse(pkgJson!);
            assert.equal(pkg.name, 'my-api');
            assert.equal(pkg.version, '1.0.0');
        });

        it('should use provided options', () => {
            const generator = new ExpressProjectGenerator({
                projectName: 'custom-api',
                version: '2.0.0',
                description: 'Custom Description',
                port: 8080,
            });
            const project = generator.generate(createTestFileIR());

            const pkgJson = findFile(project, 'package.json');
            const pkg = JSON.parse(pkgJson!);
            assert.equal(pkg.name, 'custom-api');
            assert.equal(pkg.version, '2.0.0');
            assert.equal(pkg.description, 'Custom Description');
        });
    });

    describe('generate()', () => {
        it('should generate core project files', () => {
            const project = generateExpressProject(createTestFileIR(), createDefaultOptions());

            assert.ok(findFile(project, 'package.json'), 'package.json should exist');
            assert.ok(findFile(project, 'tsconfig.json'), 'tsconfig.json should exist');
            assert.ok(findFile(project, '.env'), '.env should exist');
            assert.ok(findFile(project, '.env.example'), '.env.example should exist');
            assert.ok(findFile(project, '.gitignore'), '.gitignore should exist');
            assert.ok(findFile(project, 'README.md'), 'README.md should exist');
        });

        it('should generate server files', () => {
            const project = generateExpressProject(createTestFileIR(), createDefaultOptions());

            assert.ok(findFile(project, 'server/index.ts'), 'server/index.ts should exist');
            assert.ok(findFile(project, 'server/app.ts'), 'server/app.ts should exist');
            assert.ok(findFile(project, 'server/routes/index.ts'), 'routes/index.ts should exist');
            assert.ok(findFile(project, 'server/common/logger.ts'), 'logger.ts should exist');
            assert.ok(findFile(project, 'server/common/errorHandler.ts'), 'errorHandler.ts should exist');
            assert.ok(findFile(project, 'server/common/openApiValidator.ts'), 'openApiValidator.ts should exist');
            assert.ok(findFile(project, 'server/common/api.yaml'), 'api.yaml should exist');
        });

        it('should return project name and instructions', () => {
            const project = generateExpressProject(createTestFileIR(), createDefaultOptions());

            assert.equal(project.projectName, 'test-api');
            assert.ok(project.instructions.includes('npm install'), 'instructions should include npm install');
            assert.ok(project.instructions.includes('npm run dev'), 'instructions should include npm run dev');
        });
    });
});

// ============================================================================
// Package.json Tests
// ============================================================================

describe('Package.json generation', () => {
    it('should include correct scripts for TypeScript', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: true }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.scripts.build, 'tsc');
        assert.equal(pkg.scripts.start, 'node dist/index.js');
        assert.ok(pkg.scripts.dev.includes('ts-node-dev'), 'dev script should use ts-node-dev');
    });

    it('should include correct scripts for JavaScript', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: false }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.scripts.build, undefined);
        assert.equal(pkg.scripts.start, 'node server/index.js');
        assert.ok(pkg.scripts.dev.includes('nodemon'), 'dev script should use nodemon');
    });

    it('should include test scripts when tests enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeTests: true }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.scripts.test, 'jest');
        assert.equal(pkg.scripts['test:watch'], 'jest --watch');
        assert.equal(pkg.scripts['test:coverage'], 'jest --coverage');
    });

    it('should not include test scripts when tests disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeTests: false }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.scripts.test, undefined);
    });

    it('should include required dependencies', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.ok(pkg.dependencies.express, 'express should be included');
        assert.ok(pkg.dependencies['express-openapi-validator'], 'express-openapi-validator should be included');
        assert.ok(pkg.dependencies.cors, 'cors should be included');
        assert.ok(pkg.dependencies.helmet, 'helmet should be included');
        assert.ok(pkg.dependencies.pino, 'pino should be included');
        assert.ok(pkg.dependencies.dotenv, 'dotenv should be included');
    });

    it('should include TypeScript dev dependencies when typescript enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: true }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.ok(pkg.devDependencies.typescript, 'typescript should be included');
        assert.ok(pkg.devDependencies['ts-node-dev'], 'ts-node-dev should be included');
        assert.ok(pkg.devDependencies['@types/node'], '@types/node should be included');
        assert.ok(pkg.devDependencies['@types/express'], '@types/express should be included');
    });

    it('should include swagger-ui when API explorer enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: true }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.ok(pkg.dependencies['swagger-ui-express'], 'swagger-ui-express should be included');
        assert.ok(pkg.dependencies.yamljs, 'yamljs should be included');
    });

    it('should not include swagger-ui when API explorer disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: false }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.dependencies['swagger-ui-express'], undefined);
    });

    it('should set node version in engines', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ nodeVersion: '>=20.0.0' }));
        const pkg = JSON.parse(findFile(project, 'package.json')!);

        assert.equal(pkg.engines.node, '>=20.0.0');
    });
});

// ============================================================================
// TypeScript Config Tests
// ============================================================================

describe('tsconfig.json generation', () => {
    it('should generate tsconfig.json when typescript enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: true }));
        const tsconfig = findFile(project, 'tsconfig.json');

        assert.ok(tsconfig, 'tsconfig.json should exist');
        const config = JSON.parse(tsconfig!);
        assert.equal(config.compilerOptions.target, 'ES2022');
        assert.equal(config.compilerOptions.strict, true);
    });

    it('should have empty or no tsconfig when typescript disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: false }));
        const tsconfig = project.files.find(f => f.path === 'tsconfig.json');

        // Either no tsconfig file or empty content is acceptable
        assert.ok(tsconfig === undefined || tsconfig.content === '', 'tsconfig should be empty or not exist');
    });
});

// ============================================================================
// Environment Files Tests
// ============================================================================

describe('Environment files generation', () => {
    it('should generate .env with correct port', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ port: 8080 }));
        const env = findFile(project, '.env');

        assert.ok(env?.includes('PORT=8080'), '.env should include PORT=8080');
    });

    it('should generate .env with correct base path', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ apiBasePath: '/api/v2' }));
        const env = findFile(project, '.env');

        assert.ok(env?.includes('API_BASE_PATH=/api/v2'), '.env should include API_BASE_PATH=/api/v2');
    });

    it('should generate .env.example', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const envExample = findFile(project, '.env.example');

        assert.ok(envExample, '.env.example should exist');
        assert.ok(envExample?.includes('PORT='), '.env.example should include PORT');
    });
});

// ============================================================================
// Server Files Tests
// ============================================================================

describe('Server index generation', () => {
    it('should import dotenv and app', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const index = findFile(project, 'server/index.ts');

        assert.ok(index?.includes("import 'dotenv/config'"), 'should import dotenv');
        assert.ok(index?.includes("import app from './app'"), 'should import app');
    });

    it('should log API explorer URL when enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: true }));
        const index = findFile(project, 'server/index.ts');

        assert.ok(index?.includes('api-explorer'), 'should include api-explorer');
    });

    it('should not log API explorer URL when disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: false }));
        const index = findFile(project, 'server/index.ts');

        assert.ok(!index?.includes('api-explorer'), 'should not include api-explorer');
    });
});

describe('Express app generation', () => {
    it('should include security middleware', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes('helmet'), 'should include helmet');
        assert.ok(app?.includes('cors'), 'should include cors');
    });

    it('should include body parsing', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes('express.json()'), 'should include express.json');
        assert.ok(app?.includes('express.urlencoded'), 'should include express.urlencoded');
    });

    it('should include OpenAPI validator', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes('openApiValidator'), 'should include openApiValidator');
    });

    it('should include health check endpoint', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes('/health'), 'should include health endpoint');
        assert.ok(app?.includes("status: 'ok'"), 'should return ok status');
    });

    it('should include Swagger UI when API explorer enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: true }));
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes('swagger-ui-express'), 'should include swagger-ui-express');
        assert.ok(app?.includes('/api-explorer'), 'should include /api-explorer route');
    });

    it('should mount routes at correct base path', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ apiBasePath: '/api/v2' }));
        const app = findFile(project, 'server/app.ts');

        assert.ok(app?.includes("app.use('/api/v2', routes)"), 'should mount routes at /api/v2');
    });
});

// ============================================================================
// Routes Tests
// ============================================================================

describe('Routes generation', () => {
    it('should import controller for each operation', () => {
        const operations = [
            createTestOperation({ name: 'getUser' }),
            createTestOperation({ name: 'createUser', method: 'POST' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes('import { getUserController }'), 'should import getUserController');
        assert.ok(routes?.includes('import { createUserController }'), 'should import createUserController');
    });

    it('should register routes with correct method and path', () => {
        const operations = [
            createTestOperation({ name: 'getUser', method: 'GET', urlTemplate: '{{baseUrl}}/users/{{id}}' }),
            createTestOperation({ name: 'createUser', method: 'POST', urlTemplate: '{{baseUrl}}/users' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes("router.get('/users/:id'"), 'should register GET /users/:id');
        assert.ok(routes?.includes("router.post('/users'"), 'should register POST /users');
    });

    it('should convert template variables to Express params', () => {
        const operations = [
            createTestOperation({ urlTemplate: '{{baseUrl}}/orders/{{orderId}}/items/{{itemId}}' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes('/orders/:orderId/items/:itemId'), 'should convert to Express params');
    });
});

// ============================================================================
// Controller Tests
// ============================================================================

describe('Controller generation', () => {
    it('should generate controller for each operation', () => {
        const operations = [
            createTestOperation({ name: 'getUser' }),
            createTestOperation({ name: 'createUser', method: 'POST' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());

        assert.ok(findFile(project, 'server/controllers/getUser.ts'), 'getUser controller should exist');
        assert.ok(findFile(project, 'server/controllers/createUser.ts'), 'createUser controller should exist');
    });

    it('should import service', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('import { getUserService }'), 'should import getUserService');
    });

    it('should include error handling', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('try {'), 'should include try block');
        assert.ok(controller?.includes('catch (error)'), 'should include catch block');
        assert.ok(controller?.includes('next(error)'), 'should call next with error');
    });

    it('should extract path params from request', () => {
        const op = createTestOperation({
            inputs: [{ name: 'id', source: 'path', rawExpression: '{{id}}', required: true }],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('params: req.params'), 'should extract params');
    });

    it('should extract query params from request', () => {
        const op = createTestOperation({
            inputs: [
                { name: 'id', source: 'path', rawExpression: '{{id}}', required: true },
                { name: 'limit', source: 'query', rawExpression: '{{limit}}', required: false },
            ],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('query: req.query'), 'should extract query');
    });

    it('should extract body for POST requests', () => {
        const op = createTestOperation({
            method: 'POST',
            body: { kind: 'inline', rawBodyTemplate: '{}', mediaType: 'application/json', pipeline: [] },
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('body: req.body'), 'should extract body');
    });

    it('should generate TypeScript types when enabled', () => {
        const op = createTestOperation({
            inputs: [
                { name: 'id', source: 'path', rawExpression: '{{id}}', required: true },
                { name: 'limit', source: 'query', rawExpression: '{{limit}}', required: false },
            ],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions({ typescript: true }));
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('interface GetUserRequest'), 'should include interface');
        assert.ok(controller?.includes('params: {'), 'should include params type');
        assert.ok(controller?.includes('id: string'), 'should include id type');
    });
});

// ============================================================================
// Services Tests
// ============================================================================

describe('Services generation', () => {
    it('should generate services index file', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const services = findFile(project, 'server/services/index.ts');

        assert.ok(services, 'services index should exist');
    });

    it('should export service function for each operation', () => {
        const operations = [
            createTestOperation({ name: 'getUser' }),
            createTestOperation({ name: 'createUser', method: 'POST' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const services = findFile(project, 'server/services/index.ts');

        assert.ok(services?.includes('export async function getUserService'), 'should export getUserService');
        assert.ok(services?.includes('export async function createUserService'), 'should export createUserService');
    });

    it('should include TODO placeholder', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const services = findFile(project, 'server/services/index.ts');

        assert.ok(services?.includes('TODO: Implement'), 'should include TODO');
    });

    it('should return output fields when outputs defined', () => {
        const op = createTestOperation({
            outputs: [
                { name: 'userId', source: 'body', selector: '$.id', rawExpression: '{{response.body.id}}' },
                { name: 'userName', source: 'body', selector: '$.name', rawExpression: '{{response.body.name}}' },
            ],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const services = findFile(project, 'server/services/index.ts');

        assert.ok(services?.includes('userId: undefined'), 'should include userId');
        assert.ok(services?.includes('userName: undefined'), 'should include userName');
    });
});

// ============================================================================
// Common Utilities Tests
// ============================================================================

describe('Logger generation', () => {
    it('should use pino logger', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const logger = findFile(project, 'server/common/logger.ts');

        assert.ok(logger?.includes("import pino from 'pino'"), 'should import pino');
        assert.ok(logger?.includes('export default logger'), 'should export logger');
    });

    it('should support LOG_LEVEL env variable', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const logger = findFile(project, 'server/common/logger.ts');

        assert.ok(logger?.includes('process.env.LOG_LEVEL'), 'should support LOG_LEVEL');
    });
});

describe('Error handler generation', () => {
    it('should export errorHandler function', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const errorHandler = findFile(project, 'server/common/errorHandler.ts');

        assert.ok(errorHandler?.includes('export function errorHandler'), 'should export errorHandler');
    });

    it('should handle OpenAPI validation errors', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const errorHandler = findFile(project, 'server/common/errorHandler.ts');

        assert.ok(errorHandler?.includes("'status' in err"), 'should check for status');
        assert.ok(errorHandler?.includes('error.status'), 'should access error.status');
    });
});

describe('OpenAPI validator generation', () => {
    it('should configure express-openapi-validator', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const validator = findFile(project, 'server/common/openApiValidator.ts');

        assert.ok(validator?.includes("import * as OpenApiValidator"), 'should import OpenApiValidator');
        assert.ok(validator?.includes('OpenApiValidator.middleware'), 'should use middleware');
        assert.ok(validator?.includes('validateRequests: true'), 'should validate requests');
    });
});

// ============================================================================
// OpenAPI Spec Tests
// ============================================================================

describe('OpenAPI spec generation', () => {
    it('should generate api.yaml', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const spec = findFile(project, 'server/common/api.yaml');

        assert.ok(spec, 'api.yaml should exist');
        assert.ok(spec?.includes('openapi:'), 'should include openapi key');
        assert.ok(spec?.includes('3.0'), 'should be version 3.0');
    });

    it('should include paths for all operations', () => {
        const operations = [
            createTestOperation({ name: 'getUser', method: 'GET', urlTemplate: '{{baseUrl}}/users/{{id}}' }),
            createTestOperation({ name: 'createUser', method: 'POST', urlTemplate: '{{baseUrl}}/users' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const spec = findFile(project, 'server/common/api.yaml');

        assert.ok(spec?.includes('/users/{id}'), 'should include /users/{id}');
        assert.ok(spec?.includes('/users'), 'should include /users');
        assert.ok(spec?.includes('get:'), 'should include get method');
        assert.ok(spec?.includes('post:'), 'should include post method');
    });
});

// ============================================================================
// Docker Tests
// ============================================================================

describe('Docker files generation', () => {
    it('should generate Dockerfile when docker enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeDocker: true }));
        const dockerfile = findFile(project, 'Dockerfile');

        assert.ok(dockerfile, 'Dockerfile should exist');
        assert.ok(dockerfile?.includes('FROM node:'), 'should include FROM node');
        assert.ok(dockerfile?.includes('npm ci'), 'should include npm ci');
    });

    it('should include TypeScript build step in Dockerfile', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: true, includeDocker: true }));
        const dockerfile = findFile(project, 'Dockerfile');

        assert.ok(dockerfile?.includes('RUN npm run build'), 'should include build step');
    });

    it('should generate docker-compose.yml', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeDocker: true, port: 8080 }));
        const compose = findFile(project, 'docker-compose.yml');

        assert.ok(compose, 'docker-compose.yml should exist');
        assert.ok(compose?.includes('8080:8080'), 'should include port mapping');
    });

    it('should generate .dockerignore', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeDocker: true }));
        const dockerignore = findFile(project, '.dockerignore');

        assert.ok(dockerignore, '.dockerignore should exist');
        assert.ok(dockerignore?.includes('node_modules'), 'should include node_modules');
    });

    it('should not generate docker files when disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeDocker: false }));

        assert.equal(findFile(project, 'Dockerfile'), undefined, 'Dockerfile should not exist');
        assert.equal(findFile(project, 'docker-compose.yml'), undefined, 'docker-compose.yml should not exist');
        assert.equal(findFile(project, '.dockerignore'), undefined, '.dockerignore should not exist');
    });
});

// ============================================================================
// Test Files Tests
// ============================================================================

describe('Test files generation', () => {
    it('should generate test setup file', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeTests: true }));
        const setup = findFile(project, 'server/__tests__/setup.ts');

        assert.ok(setup, 'setup.ts should exist');
        assert.ok(setup?.includes("import app from '../app'"), 'should import app');
    });

    it('should generate test file for each operation', () => {
        const operations = [
            createTestOperation({ name: 'getUser' }),
            createTestOperation({ name: 'createUser', method: 'POST' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions({ includeTests: true }));

        assert.ok(findFile(project, 'server/__tests__/getUser.test.ts'), 'getUser test should exist');
        assert.ok(findFile(project, 'server/__tests__/createUser.test.ts'), 'createUser test should exist');
    });

    it('should include supertest in test files', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeTests: true }));
        const test = findFile(project, 'server/__tests__/getUser.test.ts');

        assert.ok(test?.includes("import request from 'supertest'"), 'should import supertest');
    });

    it('should not generate test files when disabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeTests: false }));
        const testFiles = project.files.filter(f => f.path.includes('__tests__'));

        assert.equal(testFiles.length, 0, 'should have no test files');
    });
});

// ============================================================================
// README Tests
// ============================================================================

describe('README generation', () => {
    it('should include project name and description', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({
            projectName: 'awesome-api',
            description: 'An awesome API',
        }));
        const readme = findFile(project, 'README.md');

        assert.ok(readme?.includes('# awesome-api'), 'should include project name');
        assert.ok(readme?.includes('An awesome API'), 'should include description');
    });

    it('should include getting started instructions', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions());
        const readme = findFile(project, 'README.md');

        assert.ok(readme?.includes('npm install'), 'should include npm install');
        assert.ok(readme?.includes('npm run dev'), 'should include npm run dev');
    });

    it('should list API endpoints', () => {
        const operations = [
            createTestOperation({ name: 'getUser', method: 'GET', urlTemplate: '{{baseUrl}}/users/{{id}}' }),
            createTestOperation({ name: 'createUser', method: 'POST', urlTemplate: '{{baseUrl}}/users' }),
        ];
        const project = generateExpressProject(createTestFileIR(operations), createDefaultOptions());
        const readme = findFile(project, 'README.md');

        assert.ok(readme?.includes('GET /users/:id'), 'should list GET endpoint');
        assert.ok(readme?.includes('POST /users'), 'should list POST endpoint');
    });

    it('should include API explorer section when enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeApiExplorer: true }));
        const readme = findFile(project, 'README.md');

        assert.ok(readme?.includes('API Explorer'), 'should include API Explorer section');
        assert.ok(readme?.includes('api-explorer'), 'should include api-explorer URL');
    });

    it('should include Docker section when enabled', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ includeDocker: true }));
        const readme = findFile(project, 'README.md');

        assert.ok(readme?.includes('Docker'), 'should include Docker section');
        assert.ok(readme?.includes('docker-compose'), 'should include docker-compose');
    });
});

// ============================================================================
// Path Extraction Tests
// ============================================================================

describe('Path extraction', () => {
    it('should strip baseUrl variable', () => {
        const op = createTestOperation({ urlTemplate: '{{baseUrl}}/users' });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes("'/users'"), 'should include /users path');
        assert.ok(!routes?.includes('baseUrl'), 'should not include baseUrl');
    });

    it('should convert variables to Express params', () => {
        const op = createTestOperation({ urlTemplate: '{{baseUrl}}/users/{{userId}}/posts/{{postId}}' });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes('/users/:userId/posts/:postId'), 'should convert to Express params');
    });

    it('should strip query strings', () => {
        const op = createTestOperation({ urlTemplate: '{{baseUrl}}/users?page={{page}}&limit={{limit}}' });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes("'/users'"), 'should include /users path without query');
        assert.ok(!routes?.includes('page'), 'should not include page');
        assert.ok(!routes?.includes('limit'), 'should not include limit');
    });

    it('should handle full URLs', () => {
        const op = createTestOperation({ urlTemplate: 'https://api.example.com/users/{{id}}' });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const routes = findFile(project, 'server/routes/index.ts');

        assert.ok(routes?.includes('/users/:id'), 'should include /users/:id path');
        assert.ok(!routes?.includes('api.example.com'), 'should not include host');
    });
});

// ============================================================================
// JavaScript Mode Tests
// ============================================================================

describe('JavaScript mode', () => {
    it('should generate .js files', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: false }));

        assert.ok(findFile(project, 'server/index.js'), 'server/index.js should exist');
        assert.ok(findFile(project, 'server/app.js'), 'server/app.js should exist');
        assert.ok(findFile(project, 'server/routes/index.js'), 'routes/index.js should exist');
    });

    it('should not include type annotations in JS mode', () => {
        const project = generateExpressProject(createTestFileIR(), createDefaultOptions({ typescript: false }));
        const controller = findFile(project, 'server/controllers/getUser.js');

        assert.ok(!controller?.includes(': Request'), 'should not include Request type');
        assert.ok(!controller?.includes(': Response'), 'should not include Response type');
        assert.ok(!controller?.includes('interface'), 'should not include interface');
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
    it('should handle empty operations list', () => {
        const fileIR = createTestFileIR([]);
        const project = generateExpressProject(fileIR, createDefaultOptions());

        // Should still generate core files
        assert.ok(findFile(project, 'package.json'), 'package.json should exist');
        assert.ok(findFile(project, 'server/app.ts'), 'server/app.ts should exist');
    });

    it('should handle operations with no inputs', () => {
        const op = createTestOperation({
            inputs: [],
            urlTemplate: '{{baseUrl}}/health',
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('const request = {}'), 'should have empty request');
    });

    it('should handle operations with complex body', () => {
        const op = createTestOperation({
            method: 'POST',
            body: {
                kind: 'inline',
                rawBodyTemplate: '{"user": {"name": "{{name}}", "email": "{{email}}"}}',
                mediaType: 'application/json',
                pipeline: [],
            },
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());

        // Should still generate without errors
        assert.ok(findFile(project, 'server/controllers/getUser.ts'), 'controller should exist');
    });

    it('should handle header parameters', () => {
        const op = createTestOperation({
            inputs: [
                { name: 'Authorization', source: 'header', rawExpression: '{{token}}', required: false },
            ],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        assert.ok(controller?.includes('headers:'), 'should include headers');
        assert.ok(controller?.includes("req.get('authorization')"), 'should get authorization header');
    });

    it('should sanitize invalid identifiers', () => {
        const op = createTestOperation({
            inputs: [
                { name: 'X-Custom-Header', source: 'header', rawExpression: '{{customHeader}}', required: false },
            ],
        });
        const project = generateExpressProject(createTestFileIR([op]), createDefaultOptions());
        const controller = findFile(project, 'server/controllers/getUser.ts');

        // Should convert to valid identifier
        assert.ok(controller?.includes('X_Custom_Header'), 'should sanitize to X_Custom_Header');
    });
});

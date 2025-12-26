import { strict as assert } from 'assert';
import { OpenAPIGenerator, generateOpenApiYaml, generateOpenApiDocument, OpenAPIDocument } from '../src/utils/openApiGenerator';
import { parseHttpFileToIR } from '../src/utils/irGenerator';
import { HttpFileIR, OperationIR } from '../src/utils/operationIR';

describe('OpenAPIGenerator', () => {
    describe('basic generation', () => {
        it('generates valid OpenAPI 3.0 document', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.equal(doc.openapi, '3.0.3');
            assert.ok(doc.info);
            assert.ok(doc.paths);
        });

        it('sets info from options', async () => {
            const content = `
# @name test
GET https://api.example.com/test
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir, {
                title: 'My API',
                version: '2.0.0',
                description: 'A test API',
            });

            assert.equal(doc.info.title, 'My API');
            assert.equal(doc.info.version, '2.0.0');
            assert.equal(doc.info.description, 'A test API');
        });

        it('extracts server from URL', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.servers);
            assert.equal(doc.servers?.length, 1);
            assert.equal(doc.servers?.[0].url, 'https://api.example.com');
        });

        it('uses provided baseUrl option', async () => {
            const content = `
# @name getUsers
GET /users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir, {
                baseUrl: 'https://custom.example.com',
            });

            assert.ok(doc.servers);
            assert.equal(doc.servers?.[0].url, 'https://custom.example.com');
        });
    });

    describe('path extraction', () => {
        it('extracts path from full URL', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.paths['/users']);
        });

        it('strips {{baseUrl}} from path', async () => {
            const content = `
# @name getUsers
GET {{baseUrl}}/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.paths['/users']);
        });

        it('converts {{variable}} to {variable} in path', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.paths['/users/{userId}']);
        });

        it('strips query string from path', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{name}}&limit={{limit}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.paths['/users']);
            assert.ok(!doc.paths['/users?name={name}&limit={limit}']);
        });
    });

    describe('HTTP methods', () => {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

        for (const method of methods) {
            it(`maps ${method} to correct path item property`, async () => {
                const content = `
# @name test
${method} https://api.example.com/resource
`;
                const ir = await parseHttpFileToIR(content);
                const doc = generateOpenApiDocument(ir);

                const pathItem = doc.paths['/resource'];
                const methodLower = method.toLowerCase();
                assert.ok((pathItem as any)[methodLower], `Expected ${methodLower} property on path item`);
            });
        }
    });

    describe('operation generation', () => {
        it('sets operationId from @name', async () => {
            const content = `
# @name getUserById
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users/{userId}']?.get;
            assert.equal(operation?.operationId, 'getUserById');
        });

        it('applies default tags', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir, {
                defaultTags: ['users'],
            });

            const operation = doc.paths['/users']?.get;
            assert.deepEqual(operation?.tags, ['users']);
        });

        it('generates default responses', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.get;
            assert.ok(operation?.responses);
            assert.ok(operation?.responses['200']);
            assert.ok(operation?.responses['400']);
            assert.ok(operation?.responses['500']);
        });
    });

    describe('parameter generation', () => {
        it('generates path parameters', async () => {
            const content = `
# @name getUser
GET https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users/{userId}']?.get;
            assert.ok(operation?.parameters);

            const userIdParam = operation?.parameters?.find(p => p.name === 'userId');
            assert.ok(userIdParam);
            assert.equal(userIdParam?.in, 'path');
            assert.equal(userIdParam?.required, true);
        });

        it('generates query parameters', async () => {
            const content = `
# @name searchUsers
GET https://api.example.com/users?name={{name}}&limit={{limit}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.get;
            assert.ok(operation?.parameters);

            const nameParam = operation?.parameters?.find(p => p.name === 'name');
            const limitParam = operation?.parameters?.find(p => p.name === 'limit');

            assert.ok(nameParam);
            assert.ok(limitParam);
        });

        it('generates header parameters', async () => {
            const content = `
# @name test
GET https://api.example.com/users
Authorization: Bearer {{token}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.get;
            const tokenParam = operation?.parameters?.find(p => p.name === 'token');

            assert.ok(tokenParam);
            assert.equal(tokenParam?.in, 'header');
        });

        it('does not include system variables as parameters', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"timestamp": "{{$timestamp}}", "id": "{{$guid}}"}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            const params = operation?.parameters || [];

            // System variables should not appear as parameters
            const timestampParam = params.find(p => p.name.includes('timestamp'));
            const guidParam = params.find(p => p.name.includes('guid'));

            assert.ok(!timestampParam);
            assert.ok(!guidParam);
        });
    });

    describe('request body generation', () => {
        it('generates request body for POST', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John", "email": "john@example.com"}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.post;
            assert.ok(operation?.requestBody);
            assert.ok(operation?.requestBody?.content['application/json']);
        });

        it('uses correct media type from Content-Type', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/xml

<user><name>John</name></user>
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.post;
            assert.ok(operation?.requestBody?.content['application/xml']);
        });

        it('infers schema from JSON body', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John", "age": 30, "active": true}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            // Should have inferred schema or reference
            assert.ok(schema);
            if (schema?.$ref) {
                // Schema was extracted to components
                assert.ok(doc.components?.schemas);
            } else {
                assert.equal(schema?.type, 'object');
            }
        });

        it('generates example from body template', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir, { generateExamples: true });

            const operation = doc.paths['/users']?.post;
            const mediaType = operation?.requestBody?.content['application/json'];

            // Should have example
            assert.ok(mediaType?.example || mediaType?.schema);
        });

        it('does not generate body for GET', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.get;
            assert.ok(!operation?.requestBody);
        });
    });

    describe('schema inference', () => {
        it('infers string type', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"message": "hello"}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            // Check properties or referenced schema
            if (schema?.$ref) {
                const schemaName = schema.$ref.replace('#/components/schemas/', '');
                const actualSchema = doc.components?.schemas?.[schemaName];
                assert.equal(actualSchema?.properties?.message?.type, 'string');
            } else if (schema?.properties) {
                assert.equal(schema.properties.message?.type, 'string');
            }
        });

        it('infers integer type', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"count": 42}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            if (schema?.$ref) {
                const schemaName = schema.$ref.replace('#/components/schemas/', '');
                const actualSchema = doc.components?.schemas?.[schemaName];
                assert.equal(actualSchema?.properties?.count?.type, 'integer');
            } else if (schema?.properties) {
                assert.equal(schema.properties.count?.type, 'integer');
            }
        });

        it('infers boolean type', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"active": true}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            if (schema?.$ref) {
                const schemaName = schema.$ref.replace('#/components/schemas/', '');
                const actualSchema = doc.components?.schemas?.[schemaName];
                assert.equal(actualSchema?.properties?.active?.type, 'boolean');
            } else if (schema?.properties) {
                assert.equal(schema.properties.active?.type, 'boolean');
            }
        });

        it('infers array type', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"items": [1, 2, 3]}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            if (schema?.$ref) {
                const schemaName = schema.$ref.replace('#/components/schemas/', '');
                const actualSchema = doc.components?.schemas?.[schemaName];
                assert.equal(actualSchema?.properties?.items?.type, 'array');
            } else if (schema?.properties) {
                assert.equal(schema.properties.items?.type, 'array');
            }
        });

        it('handles template variables in body', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "{{userName}}", "email": "{{userEmail}}"}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users']?.post;
            const schema = operation?.requestBody?.content['application/json']?.schema;

            // Should still generate a valid schema
            assert.ok(schema);
        });
    });

    describe('response generation', () => {
        it('generates response schema from outputs', async () => {
            const content = `
# @name login
POST https://api.example.com/login
Content-Type: application/json

{"username": "admin", "password": "secret"}

@token = {{login.response.body.$.token}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/login']?.post;
            const response = operation?.responses['200'];

            assert.ok(response);
            // Should have content with schema based on outputs
            if (response?.content) {
                const schema = response.content['application/json']?.schema;
                assert.ok(schema);
            }
        });
    });

    describe('multiple operations', () => {
        it('groups operations by path', async () => {
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
            const doc = generateOpenApiDocument(ir);

            const pathItem = doc.paths['/users'];
            assert.ok(pathItem?.get);
            assert.ok(pathItem?.post);
        });

        it('handles different paths', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users

###

# @name getProducts
GET https://api.example.com/products
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            assert.ok(doc.paths['/users']);
            assert.ok(doc.paths['/products']);
        });
    });

    describe('YAML generation', () => {
        it('generates valid YAML', async () => {
            const content = `
# @name getUsers
GET https://api.example.com/users
`;
            const ir = await parseHttpFileToIR(content);
            const yamlOutput = generateOpenApiYaml(ir);

            assert.ok(yamlOutput.includes('openapi:'));
            assert.ok(yamlOutput.includes('paths:'));
            assert.ok(yamlOutput.includes('/users:'));
        });

        it('includes all operation details in YAML', async () => {
            const content = `
# @name createUser
POST https://api.example.com/users
Content-Type: application/json

{"name": "John"}
`;
            const ir = await parseHttpFileToIR(content);
            const yamlOutput = generateOpenApiYaml(ir, {
                title: 'User API',
                version: '1.0.0',
            });

            assert.ok(yamlOutput.includes('title: User API'));
            assert.ok(yamlOutput.includes("version: '1.0.0'") || yamlOutput.includes('version: 1.0.0'));
            assert.ok(yamlOutput.includes('operationId: createUser'));
            assert.ok(yamlOutput.includes('post:'));
        });
    });

    describe('edge cases', () => {
        it('handles empty IR', async () => {
            const ir: HttpFileIR = {
                operations: [],
                fileVariables: {},
                warnings: [],
            };

            const doc = generateOpenApiDocument(ir);

            assert.equal(doc.openapi, '3.0.3');
            assert.deepEqual(doc.paths, {});
        });

        it('handles operations without body', async () => {
            const content = `
# @name deleteUser
DELETE https://api.example.com/users/{{userId}}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/users/{userId}']?.delete;
            assert.ok(operation);
            // DELETE can have body but shouldn't require it
        });

        it('handles invalid JSON body gracefully', async () => {
            const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{invalid json}
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            const operation = doc.paths['/data']?.post;
            // Should still generate operation, just with generic schema
            assert.ok(operation?.requestBody);
        });

        it('handles path without leading slash', async () => {
            const content = `
# @name test
GET api/users
`;
            const ir = await parseHttpFileToIR(content);
            const doc = generateOpenApiDocument(ir);

            // Should normalize path to have leading slash
            assert.ok(doc.paths['/api/users']);
        });
    });
});

describe('OpenAPIGenerator class', () => {
    it('accepts custom options', async () => {
        const generator = new OpenAPIGenerator({
            title: 'Custom API',
            version: '3.0.0',
            inferSchemas: false,
            generateExamples: false,
        });

        const content = `
# @name test
POST https://api.example.com/data
Content-Type: application/json

{"name": "test"}
`;
        const ir = await parseHttpFileToIR(content);
        const doc = generator.generate(ir);

        assert.equal(doc.info.title, 'Custom API');
        assert.equal(doc.info.version, '3.0.0');
    });

    it('can generate YAML directly', async () => {
        const generator = new OpenAPIGenerator();

        const content = `
# @name test
GET https://api.example.com/test
`;
        const ir = await parseHttpFileToIR(content);
        const yamlOutput = generator.generateYaml(ir);

        assert.ok(typeof yamlOutput === 'string');
        assert.ok(yamlOutput.includes('openapi:'));
    });
});

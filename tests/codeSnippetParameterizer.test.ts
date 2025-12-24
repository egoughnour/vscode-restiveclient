import { strict as assert } from 'assert';
import {
    CodeSnippetParameterizer,
    CSharpRestSharpTransformer,
    BuiltInToken,
    CSharpType,
    ParameterSpec,
    MethodWrapperConfig
} from '../src/utils/codeSnippetParameterizer';

describe('CodeSnippetParameterizer', () => {
    const parameterizer = new CodeSnippetParameterizer();
    
    // Sample RestSharp snippet (similar to what httpsnippet generates)
    const sampleSnippet = `var client = new RestClient("https://api.example.com/users");
var request = new RestRequest(Method.POST);
request.AddHeader("Content-Type", "application/json");
request.AddHeader("Authorization", "Bearer token123");
request.AddParameter("application/json", "{\\"name\\":\\"John\\",\\"age\\":30}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);`;

    describe('CSharpRestSharpTransformer', () => {
        const transformer = new CSharpRestSharpTransformer();

        describe('parameterizeValue', () => {
            it('parameterizes URL', () => {
                const spec: ParameterSpec = {
                    path: '$.url',
                    parameterName: 'apiUrl',
                    type: CSharpType.String
                };
                
                const result = transformer.parameterizeValue(sampleSnippet, spec);
                
                assert.ok(result.snippet.includes('new RestClient(apiUrl)'));
                assert.ok(!result.snippet.includes('new RestClient("https://api.example.com/users")'));
                assert.equal(result.extracted?.name, 'apiUrl');
                assert.equal(result.extracted?.originalValue, 'https://api.example.com/users');
            });

            it('parameterizes header value', () => {
                const spec: ParameterSpec = {
                    path: '$.headers.Authorization',
                    parameterName: 'authToken',
                    type: CSharpType.String
                };
                
                const result = transformer.parameterizeValue(sampleSnippet, spec);
                
                assert.ok(result.snippet.includes('request.AddHeader("Authorization", authToken)'));
                assert.equal(result.extracted?.originalValue, 'Bearer token123');
            });

            it('handles built-in token for header', () => {
                const spec: ParameterSpec = {
                    path: '$.headers.Authorization',
                    parameterName: 'authToken',
                    type: CSharpType.String,
                    builtInToken: BuiltInToken.Guid
                };
                
                const result = transformer.parameterizeValue(sampleSnippet, spec);
                
                assert.equal(result.extracted?.builtInToken, BuiltInToken.Guid);
            });
        });

        describe('wrapInMethod', () => {
            it('wraps snippet in a basic method', () => {
                const config: MethodWrapperConfig = {
                    methodName: 'CreateUser',
                    isAsync: false,
                    returnType: 'IRestResponse',
                    accessModifier: 'public',
                    isStatic: false
                };
                const params: ParameterSpec[] = [
                    { path: '$.url', parameterName: 'apiUrl', type: CSharpType.String }
                ];
                
                const result = transformer.wrapInMethod(sampleSnippet, config, params);
                
                assert.ok(result.includes('using RestSharp;'));
                assert.ok(result.includes('public IRestResponse CreateUser(string apiUrl)'));
                assert.ok(result.includes('return response;'));
            });

            it('wraps snippet in an async method', () => {
                const config: MethodWrapperConfig = {
                    methodName: 'CreateUserAsync',
                    isAsync: true,
                    returnType: 'Task<IRestResponse>',
                    accessModifier: 'public',
                    isStatic: false
                };
                
                const result = transformer.wrapInMethod(sampleSnippet, config, []);
                
                assert.ok(result.includes('public async Task<IRestResponse> CreateUserAsync()'));
            });

            it('wraps snippet with namespace and class', () => {
                const config: MethodWrapperConfig = {
                    methodName: 'CreateUser',
                    isAsync: false,
                    returnType: 'IRestResponse',
                    accessModifier: 'public',
                    isStatic: true,
                    namespace: 'MyApp.Api',
                    className: 'UserClient'
                };
                
                const result = transformer.wrapInMethod(sampleSnippet, config, []);
                
                assert.ok(result.includes('namespace MyApp.Api'));
                assert.ok(result.includes('public class UserClient'));
                assert.ok(result.includes('public static IRestResponse CreateUser()'));
            });

            it('adds XML documentation', () => {
                const config: MethodWrapperConfig = {
                    methodName: 'CreateUser',
                    isAsync: false,
                    returnType: 'IRestResponse',
                    accessModifier: 'public',
                    isStatic: false,
                    summary: 'Creates a new user in the system'
                };
                const params: ParameterSpec[] = [
                    { path: '$.url', parameterName: 'apiUrl', type: CSharpType.String }
                ];
                
                const result = transformer.wrapInMethod(sampleSnippet, config, params);
                
                assert.ok(result.includes('/// <summary>'));
                assert.ok(result.includes('/// Creates a new user in the system'));
                assert.ok(result.includes('/// <param name="apiUrl">$.url</param>'));
            });

            it('handles multiple parameters with defaults', () => {
                const config: MethodWrapperConfig = {
                    methodName: 'CreateUser',
                    isAsync: false,
                    returnType: 'IRestResponse',
                    accessModifier: 'public',
                    isStatic: false
                };
                const params: ParameterSpec[] = [
                    { path: '$.url', parameterName: 'apiUrl', type: CSharpType.String },
                    { path: '$.headers.Authorization', parameterName: 'authToken', type: CSharpType.String, defaultValue: 'null' }
                ];
                
                const result = transformer.wrapInMethod(sampleSnippet, config, params);
                
                assert.ok(result.includes('string apiUrl, string authToken = null'));
            });
        });

        describe('generateTokenHelper', () => {
            it('generates timestamp helper', () => {
                const result = transformer.generateTokenHelper(BuiltInToken.Timestamp);
                assert.ok(result.includes('ToUnixTimeMilliseconds'));
            });

            it('generates guid helper', () => {
                const result = transformer.generateTokenHelper(BuiltInToken.Guid);
                assert.ok(result.includes('Guid.NewGuid()'));
            });

            it('generates datetime helper', () => {
                const result = transformer.generateTokenHelper(BuiltInToken.DateTime);
                assert.ok(result.includes('DateTime.UtcNow'));
            });
        });
    });

    describe('parameterize', () => {
        it('parameterizes and wraps a full snippet', () => {
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'apiUrl', type: CSharpType.String },
                { path: '$.headers.Authorization', parameterName: 'authToken', type: CSharpType.String }
            ];
            const config: MethodWrapperConfig = {
                methodName: 'CreateUser',
                isAsync: false,
                returnType: 'IRestResponse',
                accessModifier: 'public',
                isStatic: false,
                namespace: 'MyApp',
                className: 'ApiClient'
            };
            
            const result = parameterizer.parameterize(
                sampleSnippet,
                'csharp',
                'restsharp',
                params,
                config
            );
            
            assert.ok(result.code.includes('namespace MyApp'));
            assert.ok(result.code.includes('new RestClient(apiUrl)'));
            assert.ok(result.code.includes('request.AddHeader("Authorization", authToken)'));
            assert.equal(result.parameters.length, 2);
        });

        it('returns unchanged snippet for unsupported target', () => {
            const result = parameterizer.parameterize(
                sampleSnippet,
                'unknown',
                'unknown',
                [],
                undefined
            );
            
            assert.equal(result.code, sampleSnippet);
            assert.equal(result.parameters.length, 0);
        });
    });

    describe('hasTransformer', () => {
        it('returns true for registered transformer', () => {
            assert.ok(parameterizer.hasTransformer('csharp', 'restsharp'));
        });

        it('returns false for unregistered transformer', () => {
            assert.ok(!parameterizer.hasTransformer('python', 'requests'));
        });
    });
});

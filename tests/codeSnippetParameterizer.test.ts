import { strict as assert } from 'assert';
import {
    CodeSnippetParameterizer,
    CSharpRestSharpTransformer,
    BuiltInToken,
    CSharpType,
    ParamType,
    ParameterSpec,
    MethodWrapperConfig
} from '../src/utils/codeSnippetParameterizer';

describe('CodeSnippetParameterizer', () => {
    const parameterizer = new CodeSnippetParameterizer();
    
    // Sample snippets for different languages (similar to what httpsnippet generates)
    const sampleSnippets = {
        restsharp: `var client = new RestClient("https://api.example.com/users");
var request = new RestRequest(Method.POST);
request.AddHeader("Content-Type", "application/json");
request.AddHeader("Authorization", "Bearer token123");
request.AddParameter("application/json", "{\\"name\\":\\"John\\",\\"age\\":30}", ParameterType.RequestBody);
IRestResponse response = client.Execute(request);`,

        pythonRequests: `import requests

url = "https://api.example.com/users"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer token123"
}
response = requests.post(url, headers=headers)`,

        javascriptFetch: `fetch("https://api.example.com/users", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer token123"
  }
})
.then(response => response.json())`,

        javaOkhttp: `OkHttpClient client = new OkHttpClient();
Request request = new Request.Builder()
  .url("https://api.example.com/users")
  .addHeader("Content-Type", "application/json")
  .addHeader("Authorization", "Bearer token123")
  .build();
Response response = client.newCall(request).execute();`,

        goNative: `req, err := http.NewRequest("POST", "https://api.example.com/users", nil)
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Authorization", "Bearer token123")
resp, err := http.DefaultClient.Do(req)`
    };

    describe('CSharpRestSharpTransformer', () => {
        const transformer = new CSharpRestSharpTransformer();

        describe('parameterizeValue', () => {
            it('parameterizes URL', () => {
                const spec: ParameterSpec = {
                    path: '$.url',
                    parameterName: 'apiUrl',
                    type: CSharpType.String
                };
                
                const result = transformer.parameterizeValue(sampleSnippets.restsharp, spec);
                
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
                
                const result = transformer.parameterizeValue(sampleSnippets.restsharp, spec);
                
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
                
                const result = transformer.parameterizeValue(sampleSnippets.restsharp, spec);
                
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
                
                const result = transformer.wrapInMethod(sampleSnippets.restsharp, config, params);
                
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
                
                const result = transformer.wrapInMethod(sampleSnippets.restsharp, config, []);
                
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
                
                const result = transformer.wrapInMethod(sampleSnippets.restsharp, config, []);
                
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
                
                const result = transformer.wrapInMethod(sampleSnippets.restsharp, config, params);
                
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
                
                const result = transformer.wrapInMethod(sampleSnippets.restsharp, config, params);
                
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

    describe('Python requests transformer', () => {
        it('parameterizes URL', () => {
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'base_url', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.pythonRequests,
                'python',
                'requests',
                params
            );
            
            // URL is assigned to a variable, so we replace the assignment
            assert.ok(result.code.includes('url = base_url'));
        });

        it('parameterizes header value', () => {
            const params: ParameterSpec[] = [
                { path: '$.headers.Authorization', parameterName: 'auth_token', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.pythonRequests,
                'python',
                'requests',
                params
            );
            
            assert.ok(result.code.includes('"Authorization": auth_token'));
        });

        it('wraps in Python function with docstring', () => {
            const config: MethodWrapperConfig = {
                methodName: 'send_request',
                isAsync: false,
                returnType: 'requests.Response',
                accessModifier: '',
                isStatic: false,
                summary: 'Sends the HTTP request'
            };
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'base_url', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.pythonRequests,
                'python',
                'requests',
                params,
                config
            );
            
            assert.ok(result.code.includes('def send_request(base_url: str):'));
            assert.ok(result.code.includes('"""Sends the HTTP request'));
            assert.ok(result.code.includes('Args:'));
        });
    });

    describe('JavaScript fetch transformer', () => {
        it('parameterizes URL', () => {
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javascriptFetch,
                'javascript',
                'fetch',
                params
            );
            
            assert.ok(result.code.includes('fetch(baseUrl'));
        });

        it('parameterizes header value', () => {
            const params: ParameterSpec[] = [
                { path: '$.headers.Authorization', parameterName: 'authToken', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javascriptFetch,
                'javascript',
                'fetch',
                params
            );
            
            assert.ok(result.code.includes('"Authorization": authToken'));
        });

        it('wraps in async function with JSDoc', () => {
            const config: MethodWrapperConfig = {
                methodName: 'sendRequest',
                isAsync: true,
                returnType: 'Promise<Response>',
                accessModifier: '',
                isStatic: false,
                summary: 'Sends the HTTP request'
            };
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javascriptFetch,
                'javascript',
                'fetch',
                params,
                config
            );
            
            assert.ok(result.code.includes('async function sendRequest(baseUrl)'));
            assert.ok(result.code.includes('* Sends the HTTP request'));
            assert.ok(result.code.includes('@param {string} baseUrl'));
        });
    });

    describe('Java OkHttp transformer', () => {
        it('parameterizes URL', () => {
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javaOkhttp,
                'java',
                'okhttp',
                params
            );
            
            assert.ok(result.code.includes('.url(baseUrl)'));
        });

        it('parameterizes header value', () => {
            const params: ParameterSpec[] = [
                { path: '$.headers.Authorization', parameterName: 'authToken', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javaOkhttp,
                'java',
                'okhttp',
                params
            );
            
            assert.ok(result.code.includes('.addHeader("Authorization", authToken)'));
        });

        it('wraps in Java method with Javadoc', () => {
            const config: MethodWrapperConfig = {
                methodName: 'sendRequest',
                isAsync: false,
                returnType: 'Response',
                accessModifier: 'public',
                isStatic: true,
                summary: 'Sends the HTTP request'
            };
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.javaOkhttp,
                'java',
                'okhttp',
                params,
                config
            );
            
            assert.ok(result.code.includes('public static Response sendRequest(String baseUrl)'));
            assert.ok(result.code.includes('* Sends the HTTP request'));
            assert.ok(result.code.includes('@param baseUrl'));
        });
    });

    describe('Go native transformer', () => {
        it('wraps in Go function with godoc', () => {
            const config: MethodWrapperConfig = {
                methodName: 'SendRequest',
                isAsync: false,
                returnType: '(*http.Response, error)',
                accessModifier: '',
                isStatic: false,
                summary: 'sends the HTTP request',
                usings: ['net/http']
            };
            const params: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: ParamType.String }
            ];
            
            const result = parameterizer.parameterize(
                sampleSnippets.goNative,
                'go',
                'native',
                params,
                config
            );
            
            assert.ok(result.code.includes('func SendRequest(baseUrl string)'));
            assert.ok(result.code.includes('// SendRequest sends the HTTP request'));
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
                sampleSnippets.restsharp,
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
                sampleSnippets.restsharp,
                'unknown',
                'unknown',
                [],
                undefined
            );
            
            assert.equal(result.code, sampleSnippets.restsharp);
            assert.equal(result.parameters.length, 0);
        });
    });

    describe('hasTransformer', () => {
        it('returns true for C# RestSharp', () => {
            assert.ok(parameterizer.hasTransformer('csharp', 'restsharp'));
        });

        it('returns true for C# HttpClient', () => {
            assert.ok(parameterizer.hasTransformer('csharp', 'httpclient'));
        });

        it('returns true for Python requests', () => {
            assert.ok(parameterizer.hasTransformer('python', 'requests'));
        });

        it('returns true for JavaScript fetch', () => {
            assert.ok(parameterizer.hasTransformer('javascript', 'fetch'));
        });

        it('returns true for JavaScript axios', () => {
            assert.ok(parameterizer.hasTransformer('javascript', 'axios'));
        });

        it('returns true for Node.js fetch', () => {
            assert.ok(parameterizer.hasTransformer('node', 'fetch'));
        });

        it('returns true for Node.js axios', () => {
            assert.ok(parameterizer.hasTransformer('node', 'axios'));
        });

        it('returns true for Java OkHttp', () => {
            assert.ok(parameterizer.hasTransformer('java', 'okhttp'));
        });

        it('returns true for Java nethttp', () => {
            assert.ok(parameterizer.hasTransformer('java', 'nethttp'));
        });

        it('returns true for Go native', () => {
            assert.ok(parameterizer.hasTransformer('go', 'native'));
        });

        it('returns false for unregistered transformer', () => {
            assert.ok(!parameterizer.hasTransformer('ruby', 'native'));
        });
    });

    describe('getSupportedTargets', () => {
        it('returns all supported target/client combinations', () => {
            const targets = parameterizer.getSupportedTargets();
            
            assert.ok(targets.length >= 10);
            assert.ok(targets.some(t => t.target === 'csharp' && t.client === 'restsharp'));
            assert.ok(targets.some(t => t.target === 'python' && t.client === 'requests'));
            assert.ok(targets.some(t => t.target === 'javascript' && t.client === 'fetch'));
            assert.ok(targets.some(t => t.target === 'java' && t.client === 'okhttp'));
            assert.ok(targets.some(t => t.target === 'go' && t.client === 'native'));
        });
    });
});

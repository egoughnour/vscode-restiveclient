/**
 * Code Snippet Parameterizer
 * 
 * Post-processes generated code snippets to:
 * 1. Wrap in method signatures with proper return types
 * 2. Parameterize hardcoded values (URLs, headers, body fields)
 * 3. Support built-in token injection for dynamic values
 */

/**
 * Built-in tokens that can be injected into parameterized code snippets
 */
export enum BuiltInToken {
    Timestamp = 'timestamp',
    Guid = 'guid',
    RandomInt = 'randomInt',
    DateTime = 'datetime',
    LocalDateTime = 'localDatetime',
    ProcessEnv = 'processEnv',
    DotEnv = 'dotenv',
}

/**
 * Describes a parameter to be extracted from the snippet
 */
export interface ParameterSpec {
    /** JSONPath or simple path to the value in the request */
    path: string;
    /** Name to use for the parameter in the generated method */
    parameterName: string;
    /** The C# type to use for this parameter */
    type: CSharpType;
    /** If this is a built-in token, specify which one */
    builtInToken?: BuiltInToken;
    /** Default value expression (C# code) */
    defaultValue?: string;
}

/**
 * Supported C# types for parameters
 */
export enum CSharpType {
    String = 'string',
    Int = 'int',
    Long = 'long',
    Double = 'double',
    Bool = 'bool',
    DateTime = 'DateTime',
    Guid = 'Guid',
    Object = 'object',
}

/**
 * Configuration for wrapping a snippet in a method
 */
export interface MethodWrapperConfig {
    /** Method name */
    methodName: string;
    /** Whether the method should be async */
    isAsync: boolean;
    /** Return type (e.g., 'IRestResponse', 'Task<IRestResponse>') */
    returnType: string;
    /** Access modifier */
    accessModifier: 'public' | 'private' | 'protected' | 'internal';
    /** Whether to make it static */
    isStatic: boolean;
    /** XML doc summary */
    summary?: string;
    /** Additional using statements needed */
    usings?: string[];
    /** Namespace to wrap in */
    namespace?: string;
    /** Class name to wrap in */
    className?: string;
}

/**
 * Result of parameterizing a code snippet
 */
export interface ParameterizedSnippet {
    /** The transformed code */
    code: string;
    /** List of parameters extracted */
    parameters: ExtractedParameter[];
    /** Required using statements */
    usings: string[];
}

export interface ExtractedParameter {
    name: string;
    type: CSharpType;
    originalValue: string;
    builtInToken?: BuiltInToken;
}

/**
 * Language-specific snippet transformer
 */
export interface SnippetTransformer {
    /**
     * Wrap the snippet in a method signature
     */
    wrapInMethod(snippet: string, config: MethodWrapperConfig, parameters: ParameterSpec[]): string;
    
    /**
     * Parameterize a value in the snippet
     */
    parameterizeValue(snippet: string, spec: ParameterSpec): { snippet: string; extracted: ExtractedParameter | null };
    
    /**
     * Generate the built-in token helper code
     */
    generateTokenHelper(token: BuiltInToken): string;
}

/**
 * C# RestSharp snippet transformer
 */
export class CSharpRestSharpTransformer implements SnippetTransformer {
    
    wrapInMethod(snippet: string, config: MethodWrapperConfig, parameters: ParameterSpec[]): string {
        const lines: string[] = [];
        
        // Usings
        const usings = new Set<string>([
            'RestSharp',
            ...(config.usings || [])
        ]);
        
        // Add usings for parameter types
        for (const param of parameters) {
            if (param.type === CSharpType.Guid) {
                usings.add('System');
            }
            if (param.type === CSharpType.DateTime) {
                usings.add('System');
            }
            if (param.builtInToken) {
                usings.add('System');
            }
        }
        
        for (const using of Array.from(usings).sort()) {
            lines.push(`using ${using};`);
        }
        lines.push('');
        
        // Namespace
        if (config.namespace) {
            lines.push(`namespace ${config.namespace}`);
            lines.push('{');
        }
        
        // Class
        if (config.className) {
            const indent = config.namespace ? '    ' : '';
            lines.push(`${indent}public class ${config.className}`);
            lines.push(`${indent}{`);
        }
        
        // XML doc
        const methodIndent = (config.namespace ? '    ' : '') + (config.className ? '    ' : '');
        if (config.summary) {
            lines.push(`${methodIndent}/// <summary>`);
            lines.push(`${methodIndent}/// ${config.summary}`);
            lines.push(`${methodIndent}/// </summary>`);
            for (const param of parameters) {
                lines.push(`${methodIndent}/// <param name="${param.parameterName}">${param.path}</param>`);
            }
        }
        
        // Method signature
        const asyncKeyword = config.isAsync ? 'async ' : '';
        const staticKeyword = config.isStatic ? 'static ' : '';
        const paramList = parameters.map(p => {
            const defaultPart = p.defaultValue ? ` = ${p.defaultValue}` : '';
            return `${p.type} ${p.parameterName}${defaultPart}`;
        }).join(', ');
        
        lines.push(`${methodIndent}${config.accessModifier} ${staticKeyword}${asyncKeyword}${config.returnType} ${config.methodName}(${paramList})`);
        lines.push(`${methodIndent}{`);
        
        // Indent and add snippet body
        const bodyIndent = methodIndent + '    ';
        const snippetLines = snippet.split('\n');
        for (const line of snippetLines) {
            lines.push(line ? `${bodyIndent}${line}` : '');
        }
        
        // Add return if needed
        if (!snippet.includes('return ')) {
            lines.push(`${bodyIndent}return response;`);
        }
        
        lines.push(`${methodIndent}}`);
        
        // Close class
        if (config.className) {
            const indent = config.namespace ? '    ' : '';
            lines.push(`${indent}}`);
        }
        
        // Close namespace
        if (config.namespace) {
            lines.push('}');
        }
        
        return lines.join('\n');
    }
    
    parameterizeValue(snippet: string, spec: ParameterSpec): { snippet: string; extracted: ExtractedParameter | null } {
        // Handle URL parameterization
        if (spec.path === '$.url' || spec.path === 'url') {
            const urlMatch = snippet.match(/new RestClient\("([^"]+)"\)/);
            if (urlMatch) {
                const originalValue = urlMatch[1];
                const newSnippet = snippet.replace(
                    `new RestClient("${originalValue}")`,
                    `new RestClient(${spec.parameterName})`
                );
                return {
                    snippet: newSnippet,
                    extracted: {
                        name: spec.parameterName,
                        type: spec.type,
                        originalValue,
                        builtInToken: spec.builtInToken
                    }
                };
            }
        }
        
        // Handle header parameterization
        if (spec.path.startsWith('$.headers.') || spec.path.startsWith('headers.')) {
            const headerName = spec.path.replace(/^\$?\.?headers\./, '');
            const headerRegex = new RegExp(`request\\.AddHeader\\("${headerName}",\\s*"([^"]+)"\\)`);
            const match = snippet.match(headerRegex);
            if (match) {
                const originalValue = match[1];
                const newSnippet = snippet.replace(
                    match[0],
                    `request.AddHeader("${headerName}", ${spec.parameterName})`
                );
                return {
                    snippet: newSnippet,
                    extracted: {
                        name: spec.parameterName,
                        type: spec.type,
                        originalValue,
                        builtInToken: spec.builtInToken
                    }
                };
            }
        }
        
        // Handle body parameterization (for JSON bodies)
        if (spec.path.startsWith('$.body.') || spec.path.startsWith('body.')) {
            const jsonPath = spec.path.replace(/^\$?\.?body\./, '');
            // This is a simplified approach - for complex JSON, we'd need a proper JSON patcher
            const bodyMatch = snippet.match(/request\.AddParameter\("[^"]+",\s*"(\{[^"]+\})"/);
            if (bodyMatch) {
                try {
                    const bodyJson = JSON.parse(bodyMatch[1].replace(/\\"/g, '"'));
                    const parts = jsonPath.split('.');
                    let current = bodyJson;
                    for (let i = 0; i < parts.length - 1; i++) {
                        current = current[parts[i]];
                    }
                    const lastKey = parts[parts.length - 1];
                    const originalValue = String(current[lastKey]);
                    
                    // Replace the value with a placeholder that we'll substitute
                    current[lastKey] = `{${spec.parameterName}}`;
                    const newBodyJson = JSON.stringify(bodyJson);
                    
                    // Use string interpolation in C#
                    const newSnippet = snippet.replace(
                        bodyMatch[0],
                        `request.AddParameter("${bodyMatch[0].match(/AddParameter\("([^"]+)"/)?.[1]}", $"${newBodyJson.replace(/"/g, '\\"').replace(`{${spec.parameterName}}`, `{${spec.parameterName}}`)}"`
                    );
                    
                    return {
                        snippet: newSnippet,
                        extracted: {
                            name: spec.parameterName,
                            type: spec.type,
                            originalValue,
                            builtInToken: spec.builtInToken
                        }
                    };
                } catch {
                    // JSON parsing failed, return unchanged
                }
            }
        }
        
        return { snippet, extracted: null };
    }
    
    generateTokenHelper(token: BuiltInToken): string {
        switch (token) {
            case BuiltInToken.Timestamp:
                return 'DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()';
            case BuiltInToken.Guid:
                return 'Guid.NewGuid().ToString()';
            case BuiltInToken.RandomInt:
                return 'new Random().Next(0, int.MaxValue).ToString()';
            case BuiltInToken.DateTime:
                return 'DateTime.UtcNow.ToString("o")';
            case BuiltInToken.LocalDateTime:
                return 'DateTime.Now.ToString("o")';
            case BuiltInToken.ProcessEnv:
                return 'Environment.GetEnvironmentVariable';
            case BuiltInToken.DotEnv:
                return '/* DotEnv requires additional setup */';
            default:
                return '/* Unknown token */';
        }
    }
}

/**
 * Main parameterizer class
 */
export class CodeSnippetParameterizer {
    private transformers: Map<string, SnippetTransformer> = new Map();
    
    constructor() {
        this.transformers.set('csharp-restsharp', new CSharpRestSharpTransformer());
    }
    
    /**
     * Parameterize a code snippet
     */
    parameterize(
        snippet: string,
        targetKey: string,
        clientKey: string,
        parameters: ParameterSpec[],
        methodConfig?: MethodWrapperConfig
    ): ParameterizedSnippet {
        const transformerKey = `${targetKey}-${clientKey}`;
        const transformer = this.transformers.get(transformerKey);
        
        if (!transformer) {
            // Return unchanged if no transformer available
            return {
                code: snippet,
                parameters: [],
                usings: []
            };
        }
        
        let currentSnippet = snippet;
        const extractedParams: ExtractedParameter[] = [];
        const usings = new Set<string>();
        
        // Apply parameterizations
        for (const param of parameters) {
            const result = transformer.parameterizeValue(currentSnippet, param);
            currentSnippet = result.snippet;
            if (result.extracted) {
                extractedParams.push(result.extracted);
            }
        }
        
        // Wrap in method if config provided
        if (methodConfig) {
            currentSnippet = transformer.wrapInMethod(currentSnippet, methodConfig, parameters);
        }
        
        return {
            code: currentSnippet,
            parameters: extractedParams,
            usings: Array.from(usings)
        };
    }
    
    /**
     * Register a custom transformer for a target/client combination
     */
    registerTransformer(targetKey: string, clientKey: string, transformer: SnippetTransformer): void {
        this.transformers.set(`${targetKey}-${clientKey}`, transformer);
    }
    
    /**
     * Check if a transformer exists for the given target/client
     */
    hasTransformer(targetKey: string, clientKey: string): boolean {
        return this.transformers.has(`${targetKey}-${clientKey}`);
    }
}

/**
 * Singleton instance
 */
export const codeSnippetParameterizer = new CodeSnippetParameterizer();

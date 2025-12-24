/**
 * Code Snippet Parameterizer
 * 
 * Post-processes generated code snippets to:
 * 1. Wrap in method/function signatures with proper return types
 * 2. Parameterize hardcoded values (URLs, headers, body fields)
 * 3. Support built-in token injection for dynamic values
 * 
 * Supported languages/clients:
 * - C# (RestSharp, HttpClient)
 * - Python (requests)
 * - JavaScript/TypeScript (fetch, axios)
 * - Java (OkHttp, java.net.http)
 * - Go (native)
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
 * Language-agnostic type representation
 */
export enum ParamType {
    String = 'string',
    Int = 'int',
    Long = 'long',
    Double = 'double',
    Bool = 'bool',
    DateTime = 'datetime',
    Guid = 'guid',
    Object = 'object',
}

// Keep CSharpType for backward compatibility
export const CSharpType = ParamType;
export type CSharpType = ParamType;

/**
 * Describes a parameter to be extracted from the snippet
 */
export interface ParameterSpec {
    /** JSONPath or simple path to the value in the request */
    path: string;
    /** Name to use for the parameter in the generated method */
    parameterName: string;
    /** The type to use for this parameter */
    type: ParamType;
    /** If this is a built-in token, specify which one */
    builtInToken?: BuiltInToken;
    /** Default value expression (in target language) */
    defaultValue?: string;
}

/**
 * Configuration for wrapping a snippet in a method/function
 */
export interface MethodWrapperConfig {
    /** Method/function name */
    methodName: string;
    /** Whether the method should be async */
    isAsync: boolean;
    /** Return type (language-specific) */
    returnType: string;
    /** Access modifier (language-specific) */
    accessModifier: 'public' | 'private' | 'protected' | 'internal' | '';
    /** Whether to make it static */
    isStatic: boolean;
    /** Doc comment summary */
    summary?: string;
    /** Additional imports/usings needed */
    usings?: string[];
    /** Namespace/package to wrap in */
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
    /** Required imports/using statements */
    usings: string[];
}

export interface ExtractedParameter {
    name: string;
    type: ParamType;
    originalValue: string;
    builtInToken?: BuiltInToken;
}

/**
 * Language-specific snippet transformer
 */
export interface SnippetTransformer {
    /** Target language key */
    readonly targetKey: string;
    /** Client key */
    readonly clientKey: string;
    /** Wrap the snippet in a method/function signature */
    wrapInMethod(snippet: string, config: MethodWrapperConfig, parameters: ParameterSpec[]): string;
    /** Parameterize a value in the snippet */
    parameterizeValue(snippet: string, spec: ParameterSpec): { snippet: string; extracted: ExtractedParameter | null };
    /** Generate the built-in token helper code */
    generateTokenHelper(token: BuiltInToken): string;
    /** Map ParamType to language-specific type string */
    mapType(type: ParamType): string;
}

/**
 * Language configuration for generalized transformers
 */
interface LanguageConfig {
    /** Comment style for docs */
    docStyle: 'xml' | 'jsdoc' | 'pydoc' | 'javadoc' | 'godoc';
    /** Import/using statement format */
    importFormat: (name: string) => string;
    /** Function signature format */
    functionFormat: (config: {
        accessModifier: string;
        isStatic: boolean;
        isAsync: boolean;
        returnType: string;
        name: string;
        params: string;
        indent: string;
    }) => string;
    /** Closing brace character */
    closingBrace: string;
    /** Opening brace character */
    openingBrace: string;
    /** Parameter format */
    paramFormat: (name: string, type: string, defaultValue?: string) => string;
    /** Type mappings */
    typeMap: Record<ParamType, string>;
    /** String interpolation format */
    interpolation: (varName: string) => string;
    /** Token helper expressions */
    tokenHelpers: Partial<Record<BuiltInToken, string>>;
    /** Default imports for this language */
    defaultImports: string[];
}

// ============================================================================
// Language Configurations
// ============================================================================

const CSHARP_CONFIG: LanguageConfig = {
    docStyle: 'xml',
    importFormat: (name) => `using ${name};`,
    functionFormat: ({ accessModifier, isStatic, isAsync, returnType, name, params, indent }) => {
        const staticKw = isStatic ? 'static ' : '';
        const asyncKw = isAsync ? 'async ' : '';
        return `${indent}${accessModifier} ${staticKw}${asyncKw}${returnType} ${name}(${params})`;
    },
    closingBrace: '}',
    openingBrace: '{',
    paramFormat: (name, type, defaultValue) => defaultValue ? `${type} ${name} = ${defaultValue}` : `${type} ${name}`,
    typeMap: {
        [ParamType.String]: 'string',
        [ParamType.Int]: 'int',
        [ParamType.Long]: 'long',
        [ParamType.Double]: 'double',
        [ParamType.Bool]: 'bool',
        [ParamType.DateTime]: 'DateTime',
        [ParamType.Guid]: 'Guid',
        [ParamType.Object]: 'object',
    },
    interpolation: (varName) => `{${varName}}`,
    tokenHelpers: {
        [BuiltInToken.Timestamp]: 'DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString()',
        [BuiltInToken.Guid]: 'Guid.NewGuid().ToString()',
        [BuiltInToken.RandomInt]: 'new Random().Next(0, int.MaxValue).ToString()',
        [BuiltInToken.DateTime]: 'DateTime.UtcNow.ToString("o")',
        [BuiltInToken.LocalDateTime]: 'DateTime.Now.ToString("o")',
        [BuiltInToken.ProcessEnv]: 'Environment.GetEnvironmentVariable',
    },
    defaultImports: ['System'],
};

const PYTHON_CONFIG: LanguageConfig = {
    docStyle: 'pydoc',
    importFormat: (name) => name.startsWith('from ') ? name : `import ${name}`,
    functionFormat: ({ isAsync, name, params, indent }) => {
        const asyncKw = isAsync ? 'async ' : '';
        return `${indent}${asyncKw}def ${name}(${params}):`;
    },
    closingBrace: '',
    openingBrace: '',
    paramFormat: (name, type, defaultValue) => defaultValue ? `${name}: ${type} = ${defaultValue}` : `${name}: ${type}`,
    typeMap: {
        [ParamType.String]: 'str',
        [ParamType.Int]: 'int',
        [ParamType.Long]: 'int',
        [ParamType.Double]: 'float',
        [ParamType.Bool]: 'bool',
        [ParamType.DateTime]: 'datetime',
        [ParamType.Guid]: 'str',
        [ParamType.Object]: 'Any',
    },
    interpolation: (varName) => `{${varName}}`,
    tokenHelpers: {
        [BuiltInToken.Timestamp]: 'str(int(time.time() * 1000))',
        [BuiltInToken.Guid]: 'str(uuid.uuid4())',
        [BuiltInToken.RandomInt]: 'str(random.randint(0, 2147483647))',
        [BuiltInToken.DateTime]: 'datetime.utcnow().isoformat()',
        [BuiltInToken.LocalDateTime]: 'datetime.now().isoformat()',
        [BuiltInToken.ProcessEnv]: 'os.environ.get',
    },
    defaultImports: [],
};

const JAVASCRIPT_CONFIG: LanguageConfig = {
    docStyle: 'jsdoc',
    importFormat: (name) => name,
    functionFormat: ({ isAsync, name, params, indent }) => {
        const asyncKw = isAsync ? 'async ' : '';
        return `${indent}${asyncKw}function ${name}(${params}) {`;
    },
    closingBrace: '}',
    openingBrace: '{',
    paramFormat: (name, _type, defaultValue) => defaultValue ? `${name} = ${defaultValue}` : name,
    typeMap: {
        [ParamType.String]: 'string',
        [ParamType.Int]: 'number',
        [ParamType.Long]: 'number',
        [ParamType.Double]: 'number',
        [ParamType.Bool]: 'boolean',
        [ParamType.DateTime]: 'Date',
        [ParamType.Guid]: 'string',
        [ParamType.Object]: 'object',
    },
    interpolation: (varName) => `\${${varName}}`,
    tokenHelpers: {
        [BuiltInToken.Timestamp]: 'Date.now().toString()',
        [BuiltInToken.Guid]: 'crypto.randomUUID()',
        [BuiltInToken.RandomInt]: 'Math.floor(Math.random() * 2147483647).toString()',
        [BuiltInToken.DateTime]: 'new Date().toISOString()',
        [BuiltInToken.LocalDateTime]: 'new Date().toLocaleString()',
        [BuiltInToken.ProcessEnv]: 'process.env',
    },
    defaultImports: [],
};

const JAVA_CONFIG: LanguageConfig = {
    docStyle: 'javadoc',
    importFormat: (name) => `import ${name};`,
    functionFormat: ({ accessModifier, isStatic, returnType, name, params, indent }) => {
        const staticKw = isStatic ? 'static ' : '';
        return `${indent}${accessModifier} ${staticKw}${returnType} ${name}(${params}) throws Exception {`;
    },
    closingBrace: '}',
    openingBrace: '{',
    paramFormat: (name, type, _defaultValue) => `${type} ${name}`,
    typeMap: {
        [ParamType.String]: 'String',
        [ParamType.Int]: 'int',
        [ParamType.Long]: 'long',
        [ParamType.Double]: 'double',
        [ParamType.Bool]: 'boolean',
        [ParamType.DateTime]: 'Instant',
        [ParamType.Guid]: 'UUID',
        [ParamType.Object]: 'Object',
    },
    interpolation: (varName) => `" + ${varName} + "`,
    tokenHelpers: {
        [BuiltInToken.Timestamp]: 'String.valueOf(System.currentTimeMillis())',
        [BuiltInToken.Guid]: 'UUID.randomUUID().toString()',
        [BuiltInToken.RandomInt]: 'String.valueOf(new Random().nextInt(Integer.MAX_VALUE))',
        [BuiltInToken.DateTime]: 'Instant.now().toString()',
        [BuiltInToken.LocalDateTime]: 'LocalDateTime.now().toString()',
        [BuiltInToken.ProcessEnv]: 'System.getenv',
    },
    defaultImports: [],
};

const GO_CONFIG: LanguageConfig = {
    docStyle: 'godoc',
    importFormat: (name) => `\t"${name}"`,
    functionFormat: ({ name, params, indent }) => {
        return `${indent}func ${name}(${params}) (*http.Response, error) {`;
    },
    closingBrace: '}',
    openingBrace: '{',
    paramFormat: (name, type, _defaultValue) => `${name} ${type}`,
    typeMap: {
        [ParamType.String]: 'string',
        [ParamType.Int]: 'int',
        [ParamType.Long]: 'int64',
        [ParamType.Double]: 'float64',
        [ParamType.Bool]: 'bool',
        [ParamType.DateTime]: 'time.Time',
        [ParamType.Guid]: 'string',
        [ParamType.Object]: 'interface{}',
    },
    interpolation: (varName) => `%s`,
    tokenHelpers: {
        [BuiltInToken.Timestamp]: 'strconv.FormatInt(time.Now().UnixMilli(), 10)',
        [BuiltInToken.Guid]: 'uuid.New().String()',
        [BuiltInToken.RandomInt]: 'strconv.Itoa(rand.Intn(math.MaxInt32))',
        [BuiltInToken.DateTime]: 'time.Now().UTC().Format(time.RFC3339)',
        [BuiltInToken.LocalDateTime]: 'time.Now().Format(time.RFC3339)',
        [BuiltInToken.ProcessEnv]: 'os.Getenv',
    },
    defaultImports: ['net/http'],
};

// ============================================================================
// URL Pattern Matchers for Different Clients
// ============================================================================

interface UrlPattern {
    /** Regex to match URL in snippet */
    pattern: RegExp;
    /** Function to generate replacement */
    replacement: (paramName: string, match: RegExpMatchArray) => string;
}

const URL_PATTERNS: Record<string, UrlPattern> = {
    // C# RestSharp
    'csharp-restsharp': {
        pattern: /new RestClient\("([^"]+)"\)/,
        replacement: (paramName) => `new RestClient(${paramName})`,
    },
    // C# HttpClient  
    'csharp-httpclient': {
        pattern: /new HttpRequestMessage\([^,]+,\s*"([^"]+)"\)/,
        replacement: (paramName, match) => match[0].replace(/"[^"]+"(?=\))/, paramName),
    },
    // Python requests - handles both inline and variable-assigned URLs
    'python-requests': {
        pattern: /(?:url\s*=\s*"([^"]+)"|requests\.(get|post|put|delete|patch)\("([^"]+)")/,
        replacement: (paramName, match) => {
            if (match[1]) {
                // Variable assignment: url = "..."
                return `url = ${paramName}`;
            }
            // Inline: requests.post("...")
            return `requests.${match[2]}(${paramName}`;
        },
    },
    // JavaScript fetch
    'javascript-fetch': {
        pattern: /fetch\("([^"]+)"/,
        replacement: (paramName) => `fetch(${paramName}`,
    },
    // JavaScript/Node axios
    'javascript-axios': {
        pattern: /axios\s*\(\s*\{[^}]*url:\s*["']([^"']+)["']/s,
        replacement: (paramName, match) => match[0].replace(/url:\s*["'][^"']+["']/, `url: ${paramName}`),
    },
    'node-axios': {
        pattern: /axios\s*\(\s*\{[^}]*url:\s*["']([^"']+)["']/s,
        replacement: (paramName, match) => match[0].replace(/url:\s*["'][^"']+["']/, `url: ${paramName}`),
    },
    // Java OkHttp
    'java-okhttp': {
        pattern: /\.url\("([^"]+)"\)/,
        replacement: (paramName) => `.url(${paramName})`,
    },
    // Java java.net.http
    'java-nethttp': {
        pattern: /URI\.create\("([^"]+)"\)/,
        replacement: (paramName) => `URI.create(${paramName})`,
    },
    // Go native
    'go-native': {
        pattern: /http\.NewRequest\("[^"]+",\s*"([^"]+)"/,
        replacement: (paramName, match) => match[0].replace(/"([^"]+)"(?=,\s*(?:nil|strings|bytes))/, paramName),
    },
};

// ============================================================================
// Header Pattern Matchers
// ============================================================================

interface HeaderPattern {
    /** Regex generator for header name */
    patternFor: (headerName: string) => RegExp;
    /** Function to generate replacement */
    replacement: (headerName: string, paramName: string) => string;
}

const HEADER_PATTERNS: Record<string, HeaderPattern> = {
    'csharp-restsharp': {
        patternFor: (h) => new RegExp(`request\\.AddHeader\\("${h}",\\s*"([^"]+)"\\)`),
        replacement: (h, p) => `request.AddHeader("${h}", ${p})`,
    },
    'csharp-httpclient': {
        patternFor: (h) => new RegExp(`request\\.Headers\\.Add\\("${h}",\\s*"([^"]+)"\\)`),
        replacement: (h, p) => `request.Headers.Add("${h}", ${p})`,
    },
    'python-requests': {
        patternFor: (h) => new RegExp(`["']${h}["']:\\s*["']([^"']+)["']`),
        replacement: (h, p) => `"${h}": ${p}`,
    },
    'javascript-fetch': {
        patternFor: (h) => new RegExp(`["']${h}["']:\\s*["']([^"']+)["']`),
        replacement: (h, p) => `"${h}": ${p}`,
    },
    'javascript-axios': {
        patternFor: (h) => new RegExp(`["']${h}["']:\\s*["']([^"']+)["']`),
        replacement: (h, p) => `"${h}": ${p}`,
    },
    'node-axios': {
        patternFor: (h) => new RegExp(`["']${h}["']:\\s*["']([^"']+)["']`),
        replacement: (h, p) => `"${h}": ${p}`,
    },
    'java-okhttp': {
        patternFor: (h) => new RegExp(`\\.addHeader\\("${h}",\\s*"([^"]+)"\\)`),
        replacement: (h, p) => `.addHeader("${h}", ${p})`,
    },
    'java-nethttp': {
        patternFor: (h) => new RegExp(`\\.header\\("${h}",\\s*"([^"]+)"\\)`),
        replacement: (h, p) => `.header("${h}", ${p})`,
    },
    'go-native': {
        patternFor: (h) => new RegExp(`req\\.Header\\.Set\\("${h}",\\s*"([^"]+)"\\)`),
        replacement: (h, p) => `req.Header.Set("${h}", ${p})`,
    },
};

// ============================================================================
// Generic Transformer Implementation  
// ============================================================================

/**
 * Generic transformer that uses language configurations
 */
class GenericTransformer implements SnippetTransformer {
    constructor(
        public readonly targetKey: string,
        public readonly clientKey: string,
        private readonly config: LanguageConfig,
        private readonly urlPattern?: UrlPattern,
        private readonly headerPattern?: HeaderPattern
    ) {}

    mapType(type: ParamType): string {
        return this.config.typeMap[type] || 'string';
    }

    generateTokenHelper(token: BuiltInToken): string {
        return this.config.tokenHelpers[token] || '/* Unknown token */';
    }

    parameterizeValue(snippet: string, spec: ParameterSpec): { snippet: string; extracted: ExtractedParameter | null } {
        // Handle URL parameterization
        if (spec.path === '$.url' || spec.path === 'url') {
            if (this.urlPattern) {
                const match = snippet.match(this.urlPattern.pattern);
                if (match) {
                    const originalValue = match[1];
                    const newSnippet = snippet.replace(
                        this.urlPattern.pattern,
                        this.urlPattern.replacement(spec.parameterName, match)
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
        }

        // Handle header parameterization
        if (spec.path.startsWith('$.headers.') || spec.path.startsWith('headers.')) {
            const headerName = spec.path.replace(/^\$?\.?headers\./, '');
            if (this.headerPattern) {
                const regex = this.headerPattern.patternFor(headerName);
                const match = snippet.match(regex);
                if (match) {
                    const originalValue = match[1];
                    const newSnippet = snippet.replace(
                        regex,
                        this.headerPattern.replacement(headerName, spec.parameterName)
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
        }

        return { snippet, extracted: null };
    }

    wrapInMethod(snippet: string, config: MethodWrapperConfig, parameters: ParameterSpec[]): string {
        const lines: string[] = [];
        const langConfig = this.config;

        // Generate imports
        const imports = new Set<string>([...langConfig.defaultImports, ...(config.usings || [])]);
        
        if (imports.size > 0) {
            if (this.targetKey === 'go') {
                lines.push('import (');
                for (const imp of Array.from(imports).sort()) {
                    lines.push(langConfig.importFormat(imp));
                }
                lines.push(')');
            } else {
                for (const imp of Array.from(imports).sort()) {
                    lines.push(langConfig.importFormat(imp));
                }
            }
            lines.push('');
        }

        // Namespace/package
        const indent = this.addNamespaceOrClass(lines, config, langConfig);

        // Doc comment
        this.addDocComment(lines, config, parameters, indent);

        // Function signature
        const paramList = parameters.map(p => 
            langConfig.paramFormat(p.parameterName, this.mapType(p.type), p.defaultValue)
        ).join(', ');

        const signature = langConfig.functionFormat({
            accessModifier: config.accessModifier,
            isStatic: config.isStatic,
            isAsync: config.isAsync,
            returnType: config.returnType,
            name: config.methodName,
            params: paramList,
            indent,
        });
        lines.push(signature);

        // Add body
        const bodyIndent = indent + '    ';
        const snippetLines = snippet.split('\n');
        for (const line of snippetLines) {
            if (this.targetKey === 'python') {
                lines.push(line ? `${bodyIndent}${line}` : '');
            } else {
                lines.push(line ? `${bodyIndent}${line}` : '');
            }
        }

        // Add return if needed
        if (this.targetKey !== 'python' && !snippet.includes('return ')) {
            lines.push(`${bodyIndent}return response;`);
        }

        // Close function
        if (langConfig.closingBrace) {
            lines.push(`${indent}${langConfig.closingBrace}`);
        }

        // Close class/namespace
        this.closeNamespaceOrClass(lines, config, langConfig);

        return lines.join('\n');
    }

    private addNamespaceOrClass(lines: string[], config: MethodWrapperConfig, langConfig: LanguageConfig): string {
        let indent = '';

        if (this.targetKey === 'csharp' || this.targetKey === 'java') {
            if (config.namespace) {
                if (this.targetKey === 'java') {
                    lines.push(`package ${config.namespace};`);
                    lines.push('');
                } else {
                    lines.push(`namespace ${config.namespace}`);
                    lines.push(langConfig.openingBrace);
                    indent = '    ';
                }
            }

            if (config.className) {
                lines.push(`${indent}public class ${config.className}`);
                lines.push(`${indent}${langConfig.openingBrace}`);
                indent += '    ';
            }
        }

        return indent;
    }

    private closeNamespaceOrClass(lines: string[], config: MethodWrapperConfig, langConfig: LanguageConfig): void {
        if (this.targetKey === 'csharp' || this.targetKey === 'java') {
            if (config.className) {
                const indent = config.namespace && this.targetKey === 'csharp' ? '    ' : '';
                lines.push(`${indent}${langConfig.closingBrace}`);
            }
            if (config.namespace && this.targetKey === 'csharp') {
                lines.push(langConfig.closingBrace);
            }
        }
    }

    private addDocComment(lines: string[], config: MethodWrapperConfig, parameters: ParameterSpec[], indent: string): void {
        if (!config.summary) return;

        switch (this.config.docStyle) {
            case 'xml':
                lines.push(`${indent}/// <summary>`);
                lines.push(`${indent}/// ${config.summary}`);
                lines.push(`${indent}/// </summary>`);
                for (const param of parameters) {
                    lines.push(`${indent}/// <param name="${param.parameterName}">${param.path}</param>`);
                }
                break;
            case 'javadoc':
                lines.push(`${indent}/**`);
                lines.push(`${indent} * ${config.summary}`);
                for (const param of parameters) {
                    lines.push(`${indent} * @param ${param.parameterName} ${param.path}`);
                }
                lines.push(`${indent} */`);
                break;
            case 'jsdoc':
                lines.push(`${indent}/**`);
                lines.push(`${indent} * ${config.summary}`);
                for (const param of parameters) {
                    lines.push(`${indent} * @param {${this.mapType(param.type)}} ${param.parameterName} - ${param.path}`);
                }
                lines.push(`${indent} */`);
                break;
            case 'pydoc':
                lines.push(`${indent}"""${config.summary}`);
                if (parameters.length > 0) {
                    lines.push('');
                    lines.push(`${indent}Args:`);
                    for (const param of parameters) {
                        lines.push(`${indent}    ${param.parameterName}: ${param.path}`);
                    }
                }
                lines.push(`${indent}"""`);
                break;
            case 'godoc':
                lines.push(`${indent}// ${config.methodName} ${config.summary}`);
                break;
        }
    }
}

// ============================================================================
// Legacy C# RestSharp Transformer (for backward compatibility)
// ============================================================================

/**
 * C# RestSharp snippet transformer - kept for backward compatibility
 */
export class CSharpRestSharpTransformer implements SnippetTransformer {
    readonly targetKey = 'csharp';
    readonly clientKey = 'restsharp';
    private readonly generic: GenericTransformer;

    constructor() {
        this.generic = new GenericTransformer(
            'csharp', 
            'restsharp', 
            CSHARP_CONFIG,
            URL_PATTERNS['csharp-restsharp'],
            HEADER_PATTERNS['csharp-restsharp']
        );
    }

    mapType(type: ParamType): string {
        return this.generic.mapType(type);
    }

    wrapInMethod(snippet: string, config: MethodWrapperConfig, parameters: ParameterSpec[]): string {
        return this.generic.wrapInMethod(snippet, config, parameters);
    }
    
    parameterizeValue(snippet: string, spec: ParameterSpec): { snippet: string; extracted: ExtractedParameter | null } {
        return this.generic.parameterizeValue(snippet, spec);
    }
    
    generateTokenHelper(token: BuiltInToken): string {
        return this.generic.generateTokenHelper(token);
    }
}

// ============================================================================
// Main Parameterizer Class
// ============================================================================

/**
 * Main parameterizer class
 */
export class CodeSnippetParameterizer {
    private transformers: Map<string, SnippetTransformer> = new Map();
    
    constructor() {
        // Register all supported transformers
        this.registerBuiltInTransformers();
    }

    private registerBuiltInTransformers(): void {
        // C# clients
        this.registerGenericTransformer('csharp', 'restsharp', CSHARP_CONFIG);
        this.registerGenericTransformer('csharp', 'httpclient', CSHARP_CONFIG);

        // Python clients
        this.registerGenericTransformer('python', 'requests', PYTHON_CONFIG);

        // JavaScript clients
        this.registerGenericTransformer('javascript', 'fetch', JAVASCRIPT_CONFIG);
        this.registerGenericTransformer('javascript', 'axios', JAVASCRIPT_CONFIG);

        // Node.js clients  
        this.registerGenericTransformer('node', 'fetch', JAVASCRIPT_CONFIG);
        this.registerGenericTransformer('node', 'axios', JAVASCRIPT_CONFIG);

        // Java clients
        this.registerGenericTransformer('java', 'okhttp', JAVA_CONFIG);
        this.registerGenericTransformer('java', 'nethttp', JAVA_CONFIG);

        // Go client
        this.registerGenericTransformer('go', 'native', GO_CONFIG);
    }

    private registerGenericTransformer(target: string, client: string, config: LanguageConfig): void {
        const key = `${target}-${client}`;
        this.transformers.set(key, new GenericTransformer(
            target,
            client,
            config,
            URL_PATTERNS[key],
            HEADER_PATTERNS[key]
        ));
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

    /**
     * Get all supported target/client combinations
     */
    getSupportedTargets(): Array<{ target: string; client: string }> {
        return Array.from(this.transformers.keys()).map(key => {
            const [target, client] = key.split('-');
            return { target, client };
        });
    }
}

/**
 * Singleton instance
 */
export const codeSnippetParameterizer = new CodeSnippetParameterizer();

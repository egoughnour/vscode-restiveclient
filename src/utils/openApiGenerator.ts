/**
 * OpenAPI YAML Generator
 *
 * Generates OpenAPI 3.0 specification from OperationIR.
 * This bridges .http files to server contract generation via generator-express-no-stress
 * or other OpenAPI-consuming tools.
 */

import * as yaml from 'js-yaml';
import {
    OperationIR,
    HttpFileIR,
    InputBinding,
    BodySpec,
    PatchRule,
} from './operationIR';

// ============================================================================
// OpenAPI 3.0 Types (subset needed for generation)
// ============================================================================

export interface OpenAPIInfo {
    title: string;
    version: string;
    description?: string;
}

export interface OpenAPIServer {
    url: string;
    description?: string;
}

export interface OpenAPIParameter {
    name: string;
    in: 'path' | 'query' | 'header' | 'cookie';
    required?: boolean;
    description?: string;
    schema: OpenAPISchema;
}

export interface OpenAPISchema {
    type?: string;
    format?: string;
    properties?: Record<string, OpenAPISchema>;
    items?: OpenAPISchema;
    required?: string[];
    example?: unknown;
    additionalProperties?: boolean | OpenAPISchema;
    $ref?: string;
}

export interface OpenAPIMediaType {
    schema?: OpenAPISchema;
    example?: unknown;
}

export interface OpenAPIRequestBody {
    description?: string;
    required?: boolean;
    content: Record<string, OpenAPIMediaType>;
}

export interface OpenAPIResponse {
    description: string;
    content?: Record<string, OpenAPIMediaType>;
    headers?: Record<string, { schema: OpenAPISchema; description?: string }>;
}

export interface OpenAPIOperation {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters?: OpenAPIParameter[];
    requestBody?: OpenAPIRequestBody;
    responses: Record<string, OpenAPIResponse>;
    deprecated?: boolean;
    security?: Array<Record<string, string[]>>;
}

export interface OpenAPIPathItem {
    summary?: string;
    description?: string;
    get?: OpenAPIOperation;
    put?: OpenAPIOperation;
    post?: OpenAPIOperation;
    delete?: OpenAPIOperation;
    options?: OpenAPIOperation;
    head?: OpenAPIOperation;
    patch?: OpenAPIOperation;
    trace?: OpenAPIOperation;
    parameters?: OpenAPIParameter[];
}

export interface OpenAPIComponents {
    schemas?: Record<string, OpenAPISchema>;
    responses?: Record<string, OpenAPIResponse>;
    parameters?: Record<string, OpenAPIParameter>;
    securitySchemes?: Record<string, unknown>;
}

export interface OpenAPIDocument {
    openapi: string;
    info: OpenAPIInfo;
    servers?: OpenAPIServer[];
    paths: Record<string, OpenAPIPathItem>;
    components?: OpenAPIComponents;
    tags?: Array<{ name: string; description?: string }>;
}

// ============================================================================
// Generator Options
// ============================================================================

export interface OpenAPIGeneratorOptions {
    /** API title (default: "Generated API") */
    title?: string;
    /** API version (default: "1.0.0") */
    version?: string;
    /** API description */
    description?: string;
    /** Base URL to extract as server (if not using {{baseUrl}}) */
    baseUrl?: string;
    /** Whether to generate example values from body templates */
    generateExamples?: boolean;
    /** Whether to infer schemas from JSON body templates */
    inferSchemas?: boolean;
    /** Tags to apply to all operations */
    defaultTags?: string[];
    /** Strip {{baseUrl}} from paths (default: true) */
    stripBaseUrl?: boolean;
}

// ============================================================================
// OpenAPI Generator
// ============================================================================

export class OpenAPIGenerator {
    private readonly options: Required<OpenAPIGeneratorOptions>;
    private schemas: Record<string, OpenAPISchema> = {};
    private schemaCounter = 0;

    constructor(options: OpenAPIGeneratorOptions = {}) {
        this.options = {
            title: options.title ?? 'Generated API',
            version: options.version ?? '1.0.0',
            description: options.description ?? '',
            baseUrl: options.baseUrl ?? '',
            generateExamples: options.generateExamples ?? true,
            inferSchemas: options.inferSchemas ?? true,
            defaultTags: options.defaultTags ?? [],
            stripBaseUrl: options.stripBaseUrl ?? true,
        };
    }

    /**
     * Generate OpenAPI document from HttpFileIR.
     */
    generate(fileIR: HttpFileIR): OpenAPIDocument {
        this.schemas = {};
        this.schemaCounter = 0;

        const paths: Record<string, OpenAPIPathItem> = {};
        const servers: OpenAPIServer[] = [];
        let detectedBaseUrl = '';

        // Process each operation
        for (const op of fileIR.operations) {
            const { path, baseUrl } = this.extractPath(op.urlTemplate);

            // Track base URL for server extraction
            if (baseUrl && !detectedBaseUrl) {
                detectedBaseUrl = baseUrl;
            }

            // Get or create path item
            if (!paths[path]) {
                paths[path] = {};
            }

            // Generate operation
            const operation = this.generateOperation(op);
            const method = op.method.toLowerCase() as keyof OpenAPIPathItem;

            // Assign to appropriate method
            if (this.isValidMethod(method)) {
                (paths[path] as Record<string, OpenAPIOperation>)[method] = operation;
            }
        }

        // Build servers array
        const serverUrl = this.options.baseUrl || detectedBaseUrl;
        if (serverUrl) {
            servers.push({ url: serverUrl });
        }

        // Build document
        const doc: OpenAPIDocument = {
            openapi: '3.0.3',
            info: {
                title: this.options.title,
                version: this.options.version,
            },
            paths,
        };

        if (this.options.description) {
            doc.info.description = this.options.description;
        }

        if (servers.length > 0) {
            doc.servers = servers;
        }

        // Add schemas if any were generated
        if (Object.keys(this.schemas).length > 0) {
            doc.components = {
                schemas: this.schemas,
            };
        }

        return doc;
    }

    /**
     * Generate OpenAPI YAML string.
     */
    generateYaml(fileIR: HttpFileIR): string {
        const doc = this.generate(fileIR);
        return yaml.dump(doc, {
            indent: 2,
            lineWidth: -1, // Don't wrap lines
            noRefs: true,
            sortKeys: false,
        });
    }

    /**
     * Extract path from URL template.
     */
    private extractPath(urlTemplate: string): { path: string; baseUrl: string } {
        let url = urlTemplate;
        let baseUrl = '';

        // Extract and remove {{baseUrl}} or similar patterns
        if (this.options.stripBaseUrl) {
            const baseUrlMatch = url.match(/^\{\{(\w*[Bb]ase[Uu]rl\w*)\}\}/);
            if (baseUrlMatch) {
                url = url.slice(baseUrlMatch[0].length);
            }
        }

        // Try to parse as URL to extract base
        try {
            // Handle fully qualified URLs
            if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
                baseUrl = `${urlObj.protocol}//${urlObj.host}`;
                url = url.slice(baseUrl.length);
            }
        } catch {
            // Not a valid URL, treat as path
        }

        // Convert {{variable}} to {variable} for path params
        let path = url.replace(/\{\{(\w+)\}\}/g, '{$1}');

        // Ensure path starts with /
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        // Remove query string for path (params will be extracted separately)
        const queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.slice(0, queryIndex);
        }

        return { path, baseUrl };
    }

    /**
     * Generate OpenAPI operation from OperationIR.
     */
    private generateOperation(op: OperationIR): OpenAPIOperation {
        const operation: OpenAPIOperation = {
            operationId: op.name,
            responses: {},
        };

        // Add summary from title or name
        if (op.title) {
            operation.summary = op.title;
        }

        // Add tags
        if (this.options.defaultTags.length > 0) {
            operation.tags = [...this.options.defaultTags];
        }

        // Add deprecated flag from metadata
        if (op.metadata.note) {
            operation.description = 'Note: This operation requires confirmation before execution.';
        }

        // Generate parameters
        const parameters = this.generateParameters(op);
        if (parameters.length > 0) {
            operation.parameters = parameters;
        }

        // Generate request body
        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            operation.requestBody = this.generateRequestBody(op);
        }

        // Generate responses
        operation.responses = this.generateResponses(op);

        return operation;
    }

    /**
     * Generate parameters from inputs.
     */
    private generateParameters(op: OperationIR): OpenAPIParameter[] {
        const parameters: OpenAPIParameter[] = [];
        const { path } = this.extractPath(op.urlTemplate);

        for (const input of op.inputs) {
            // Skip system and config variables
            if (input.source === 'system' || input.source === 'config') {
                continue;
            }

            // Skip body variables (handled in requestBody)
            if (input.source === 'body') {
                continue;
            }

            const param: OpenAPIParameter = {
                name: input.name,
                in: this.mapInputSourceToIn(input.source),
                schema: { type: 'string' },
            };

            // Path parameters are always required
            if (input.source === 'path') {
                param.required = true;
            } else if (input.required) {
                param.required = true;
            }

            // Check if this path param exists in the path
            if (input.source === 'path' && !path.includes(`{${input.name}}`)) {
                // It might be a query param that looks like path
                param.in = 'query';
            }

            parameters.push(param);
        }

        return parameters;
    }

    /**
     * Map InputBindingSource to OpenAPI parameter location.
     */
    private mapInputSourceToIn(source: string): 'path' | 'query' | 'header' {
        switch (source) {
            case 'path':
                return 'path';
            case 'query':
                return 'query';
            case 'header':
                return 'header';
            default:
                return 'query';
        }
    }

    /**
     * Generate request body.
     */
    private generateRequestBody(op: OperationIR): OpenAPIRequestBody {
        const mediaType = op.body.mediaType || 'application/json';
        const content: Record<string, OpenAPIMediaType> = {};

        const mediaTypeContent: OpenAPIMediaType = {};

        // Try to infer schema from body template
        if (this.options.inferSchemas && op.body.rawBodyTemplate) {
            const schema = this.inferSchemaFromBody(op.body, op.name);
            if (schema) {
                mediaTypeContent.schema = schema;
            }
        }

        // Add example if configured
        if (this.options.generateExamples && op.body.rawBodyTemplate) {
            const example = this.tryParseExample(op.body.rawBodyTemplate, mediaType);
            if (example !== undefined) {
                mediaTypeContent.example = example;
            }
        }

        // If no schema was inferred, use a generic object schema
        if (!mediaTypeContent.schema) {
            mediaTypeContent.schema = { type: 'object' };
        }

        content[mediaType] = mediaTypeContent;

        return {
            required: true,
            content,
        };
    }

    /**
     * Infer schema from body template.
     */
    private inferSchemaFromBody(body: BodySpec, operationName: string): OpenAPISchema | undefined {
        if (!body.rawBodyTemplate) {
            return undefined;
        }

        const mediaType = body.mediaType || '';

        // Only infer for JSON
        if (!this.isJsonMediaType(mediaType)) {
            return { type: 'object' };
        }

        try {
            // Replace template variables with placeholder values for parsing
            const normalized = this.normalizeTemplateForParsing(body.rawBodyTemplate);
            const parsed = JSON.parse(normalized);

            // Generate schema from parsed JSON
            const schema = this.jsonToSchema(parsed);

            // If we have patch rules, enhance the schema with those fields
            if (body.patch?.jsonRules) {
                this.enhanceSchemaFromPatchRules(schema, body.patch.jsonRules);
            }

            // Optionally create a named schema
            if (this.shouldCreateNamedSchema(schema)) {
                const schemaName = this.generateSchemaName(operationName, 'Request');
                this.schemas[schemaName] = schema;
                return { $ref: `#/components/schemas/${schemaName}` };
            }

            return schema;
        } catch {
            // If parsing fails, return generic object
            return { type: 'object' };
        }
    }

    /**
     * Normalize template for JSON parsing.
     */
    private normalizeTemplateForParsing(template: string): string {
        // Replace {{variable}} with placeholder strings
        return template.replace(/\{\{([^}]+)\}\}/g, '"__VAR_$1__"');
    }

    /**
     * Convert JSON value to OpenAPI schema.
     */
    private jsonToSchema(value: unknown): OpenAPISchema {
        if (value === null) {
            return { type: 'string', example: null };
        }

        if (Array.isArray(value)) {
            if (value.length === 0) {
                return { type: 'array', items: { type: 'object' } };
            }
            return {
                type: 'array',
                items: this.jsonToSchema(value[0]),
            };
        }

        if (typeof value === 'object') {
            const properties: Record<string, OpenAPISchema> = {};
            const required: string[] = [];

            for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
                properties[key] = this.jsonToSchema(val);
                // Treat all fields as required unless they have a template variable
                if (typeof val === 'string' && !val.startsWith('__VAR_')) {
                    required.push(key);
                }
            }

            const schema: OpenAPISchema = { type: 'object', properties };
            if (required.length > 0) {
                schema.required = required;
            }
            return schema;
        }

        if (typeof value === 'string') {
            // Check if it's a placeholder variable
            if (value.startsWith('__VAR_')) {
                return { type: 'string' };
            }
            return { type: 'string', example: value };
        }

        if (typeof value === 'number') {
            return Number.isInteger(value)
                ? { type: 'integer', example: value }
                : { type: 'number', example: value };
        }

        if (typeof value === 'boolean') {
            return { type: 'boolean', example: value };
        }

        return { type: 'string' };
    }

    /**
     * Enhance schema from patch rules.
     */
    private enhanceSchemaFromPatchRules(schema: OpenAPISchema, rules: PatchRule[]): void {
        // For each patch rule, ensure the target path exists in the schema
        for (const rule of rules) {
            // Simple JSONPath parsing - just handle $.a.b.c patterns
            const pathParts = this.parseSimpleJsonPath(rule.path);
            if (pathParts.length === 0) {
                continue;
            }

            this.ensurePathInSchema(schema, pathParts);
        }
    }

    /**
     * Parse simple JSONPath to parts.
     */
    private parseSimpleJsonPath(path: string): string[] {
        // Handle $.a.b.c patterns
        if (!path.startsWith('$.') && !path.startsWith('$[')) {
            return [];
        }

        const withoutRoot = path.slice(2);
        // Split on . but not inside brackets
        const parts: string[] = [];
        let current = '';
        let bracketDepth = 0;

        for (const ch of withoutRoot) {
            if (ch === '[') {
                bracketDepth++;
                current += ch;
            } else if (ch === ']') {
                bracketDepth--;
                current += ch;
            } else if (ch === '.' && bracketDepth === 0) {
                if (current) {
                    parts.push(current);
                }
                current = '';
            } else {
                current += ch;
            }
        }
        if (current) {
            parts.push(current);
        }

        return parts;
    }

    /**
     * Ensure a path exists in schema.
     */
    private ensurePathInSchema(schema: OpenAPISchema, parts: string[]): void {
        let current = schema;

        for (const part of parts) {
            // Skip array indices and wildcards
            if (part === '*' || /^\d+$/.test(part) || part.startsWith('[')) {
                continue;
            }

            if (!current.properties) {
                current.properties = {};
            }

            if (!current.properties[part]) {
                current.properties[part] = { type: 'string' };
            }

            current = current.properties[part];
        }
    }

    /**
     * Check if should create a named schema.
     */
    private shouldCreateNamedSchema(schema: OpenAPISchema): boolean {
        // Create named schemas for objects with multiple properties
        return schema.type === 'object' &&
            schema.properties !== undefined &&
            Object.keys(schema.properties).length >= 2;
    }

    /**
     * Generate a schema name.
     */
    private generateSchemaName(operationName: string, suffix: string): string {
        // Convert operation name to PascalCase
        const pascalCase = operationName
            .replace(/([a-z])([A-Z])/g, '$1$2')
            .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
            .replace(/^(.)/, (_, c) => c.toUpperCase());

        return `${pascalCase}${suffix}`;
    }

    /**
     * Try to parse example from body template.
     */
    private tryParseExample(template: string, mediaType: string): unknown | undefined {
        if (!this.isJsonMediaType(mediaType)) {
            return template;
        }

        try {
            // Try to parse as JSON, replacing variables with example values
            const withExamples = template.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
                // Generate example based on variable name
                return `"example_${varName}"`;
            });
            return JSON.parse(withExamples);
        } catch {
            return undefined;
        }
    }

    /**
     * Generate responses.
     */
    private generateResponses(op: OperationIR): Record<string, OpenAPIResponse> {
        const responses: Record<string, OpenAPIResponse> = {};

        // Default 200 response
        const response: OpenAPIResponse = {
            description: 'Successful response',
        };

        // If we have outputs, generate response schema from them
        if (op.outputs.length > 0) {
            const schema = this.generateResponseSchemaFromOutputs(op);
            if (schema) {
                response.content = {
                    'application/json': { schema },
                };
            }
        }

        responses['200'] = response;

        // Add common error responses
        responses['400'] = { description: 'Bad request' };
        responses['500'] = { description: 'Internal server error' };

        return responses;
    }

    /**
     * Generate response schema from outputs.
     */
    private generateResponseSchemaFromOutputs(op: OperationIR): OpenAPISchema | undefined {
        if (op.outputs.length === 0) {
            return undefined;
        }

        const properties: Record<string, OpenAPISchema> = {};

        for (const output of op.outputs) {
            if (output.source === 'body') {
                // Parse selector to determine property name and type
                const propName = this.extractPropertyNameFromSelector(output.selector);
                properties[propName || output.name] = { type: 'string' };
            }
        }

        if (Object.keys(properties).length === 0) {
            return undefined;
        }

        return {
            type: 'object',
            properties,
        };
    }

    /**
     * Extract property name from JSONPath selector.
     */
    private extractPropertyNameFromSelector(selector: string): string | undefined {
        if (!selector) {
            return undefined;
        }

        // Handle $.property or $['property'] patterns
        const match = selector.match(/^\$\.(\w+)/) || selector.match(/^\$\['([^']+)'\]/);
        if (match) {
            return match[1];
        }

        // For more complex paths, use the last segment
        const parts = this.parseSimpleJsonPath('$.' + selector);
        return parts.length > 0 ? parts[parts.length - 1] : undefined;
    }

    /**
     * Check if media type is JSON.
     */
    private isJsonMediaType(mediaType: string): boolean {
        return mediaType.includes('json');
    }

    /**
     * Check if method supports request body.
     */
    private methodSupportsBody(method: string): boolean {
        const methodUpper = method.toUpperCase();
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
    }

    /**
     * Check if method is valid for OpenAPI path item.
     */
    private isValidMethod(method: string): method is keyof OpenAPIPathItem {
        return ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method);
    }
}

/**
 * Convenience function to generate OpenAPI YAML from HttpFileIR.
 */
export function generateOpenApiYaml(
    fileIR: HttpFileIR,
    options?: OpenAPIGeneratorOptions
): string {
    const generator = new OpenAPIGenerator(options);
    return generator.generateYaml(fileIR);
}

/**
 * Convenience function to generate OpenAPI document from HttpFileIR.
 */
export function generateOpenApiDocument(
    fileIR: HttpFileIR,
    options?: OpenAPIGeneratorOptions
): OpenAPIDocument {
    const generator = new OpenAPIGenerator(options);
    return generator.generate(fileIR);
}

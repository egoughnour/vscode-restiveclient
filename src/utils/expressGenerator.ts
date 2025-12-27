/**
 * Express Route and Handler Generator
 *
 * Generates Express.js route registrations and handler scaffolds from OperationIR.
 * Works in conjunction with OpenAPI generation for generator-express-no-stress workflow.
 */

import {
    OperationIR,
    HttpFileIR,
    BodySpec,
} from './operationIR';

// ============================================================================
// Generator Options
// ============================================================================

export interface ExpressGeneratorOptions {
    /** Whether to generate TypeScript (default: true) */
    typescript?: boolean;
    /** Whether to generate async handlers (default: true) */
    asyncHandlers?: boolean;
    /** Whether to generate validation code (default: true) */
    generateValidation?: boolean;
    /** Whether to generate implementation hooks (default: true) */
    generateImplementationHooks?: boolean;
    /** Whether to generate a router module or inline routes (default: 'router') */
    routeStyle?: 'router' | 'app';
    /** Base path prefix for all routes (default: '') */
    basePath?: string;
    /** Whether to generate JSDoc/TSDoc comments (default: true) */
    generateDocs?: boolean;
    /** Whether to generate error handling (default: true) */
    generateErrorHandling?: boolean;
    /** Import style for Express types */
    importStyle?: 'named' | 'namespace';
    /** Whether to strip {{baseUrl}} from paths (default: true) */
    stripBaseUrl?: boolean;
    /** Module name for implementation hooks (default: './impl') */
    implModulePath?: string;
}

// ============================================================================
// Generated Code Types
// ============================================================================

export interface GeneratedRoute {
    /** The operation this route was generated from */
    operationName: string;
    /** HTTP method (lowercase) */
    method: string;
    /** Express route path */
    path: string;
    /** Generated handler code */
    handlerCode: string;
    /** Generated type definitions (if TypeScript) */
    types?: string;
}

export interface GeneratedExpressApp {
    /** Import statements */
    imports: string;
    /** Type definitions (if TypeScript) */
    types: string;
    /** Route registration code */
    routes: string;
    /** Handler implementations */
    handlers: string;
    /** Implementation hook interfaces */
    implInterfaces: string;
    /** Complete file content */
    fullContent: string;
}

// ============================================================================
// Express Generator
// ============================================================================

export class ExpressGenerator {
    private readonly options: Required<ExpressGeneratorOptions>;
    private readonly indent = '  ';

    constructor(options: ExpressGeneratorOptions = {}) {
        this.options = {
            typescript: options.typescript ?? true,
            asyncHandlers: options.asyncHandlers ?? true,
            generateValidation: options.generateValidation ?? true,
            generateImplementationHooks: options.generateImplementationHooks ?? true,
            routeStyle: options.routeStyle ?? 'router',
            basePath: options.basePath ?? '',
            generateDocs: options.generateDocs ?? true,
            generateErrorHandling: options.generateErrorHandling ?? true,
            importStyle: options.importStyle ?? 'named',
            stripBaseUrl: options.stripBaseUrl ?? true,
            implModulePath: options.implModulePath ?? './impl',
        };
    }

    /**
     * Generate complete Express application code from HttpFileIR.
     */
    generate(fileIR: HttpFileIR): GeneratedExpressApp {
        const routes: GeneratedRoute[] = [];

        // Generate routes for each operation
        for (const op of fileIR.operations) {
            const route = this.generateRoute(op);
            routes.push(route);
        }

        // Build sections
        const imports = this.generateImports(routes);
        const types = this.generateTypes(fileIR.operations);
        const handlers = this.generateHandlers(routes);
        const routeRegistrations = this.generateRouteRegistrations(routes);
        const implInterfaces = this.generateImplInterfaces(fileIR.operations);

        // Combine into full content
        const sections: string[] = [];

        sections.push(imports);

        if (types) {
            sections.push('');
            sections.push('// ============================================================================');
            sections.push('// Types');
            sections.push('// ============================================================================');
            sections.push('');
            sections.push(types);
        }

        if (implInterfaces) {
            sections.push('');
            sections.push('// ============================================================================');
            sections.push('// Implementation Interfaces');
            sections.push('// ============================================================================');
            sections.push('');
            sections.push(implInterfaces);
        }

        sections.push('');
        sections.push('// ============================================================================');
        sections.push('// Handlers');
        sections.push('// ============================================================================');
        sections.push('');
        sections.push(handlers);

        sections.push('');
        sections.push('// ============================================================================');
        sections.push('// Routes');
        sections.push('// ============================================================================');
        sections.push('');
        sections.push(routeRegistrations);

        return {
            imports,
            types,
            routes: routeRegistrations,
            handlers,
            implInterfaces,
            fullContent: sections.join('\n'),
        };
    }

    /**
     * Generate a single route from an operation.
     */
    generateRoute(op: OperationIR): GeneratedRoute {
        const path = this.extractPath(op.urlTemplate);
        const method = op.method.toLowerCase();
        const handlerCode = this.generateHandler(op);
        const types = this.options.typescript ? this.generateOperationTypes(op) : undefined;

        return {
            operationName: op.name,
            method,
            path,
            handlerCode,
            types,
        };
    }

    /**
     * Extract Express path from URL template.
     */
    private extractPath(urlTemplate: string): string {
        let url = urlTemplate;

        // Strip {{baseUrl}} if configured
        if (this.options.stripBaseUrl) {
            url = url.replace(/^\{\{(\w*[Bb]ase[Uu]rl\w*)\}\}/, '');
        }

        // Remove protocol and host if present
        try {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
                url = url.slice(`${urlObj.protocol}//${urlObj.host}`.length);
            }
        } catch {
            // Not a valid URL, continue with original
        }

        // Convert {{variable}} to :variable for Express
        let path = url.replace(/\{\{(\w+)\}\}/g, ':$1');

        // Ensure path starts with /
        if (!path.startsWith('/')) {
            path = '/' + path;
        }

        // Remove query string (Express handles query params separately)
        const queryIndex = path.indexOf('?');
        if (queryIndex >= 0) {
            path = path.slice(0, queryIndex);
        }

        // Add base path prefix
        if (this.options.basePath) {
            path = this.options.basePath + path;
        }

        return path;
    }

    /**
     * Generate imports section.
     */
    private generateImports(routes: GeneratedRoute[]): string {
        const lines: string[] = [];

        if (this.options.typescript) {
            if (this.options.importStyle === 'namespace') {
                lines.push("import * as express from 'express';");
                lines.push('import { Request, Response, NextFunction, Router } from \'express\';');
            } else {
                lines.push("import { Request, Response, NextFunction, Router } from 'express';");
            }
        } else {
            lines.push("const express = require('express');");
            lines.push('const { Router } = express;');
        }

        if (this.options.generateImplementationHooks) {
            const implImports = routes.map(r => `${r.operationName}Impl`).join(', ');
            if (this.options.typescript) {
                lines.push(`import { ${implImports} } from '${this.options.implModulePath}';`);
            } else {
                lines.push(`const { ${implImports} } = require('${this.options.implModulePath}');`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Generate TypeScript types for all operations.
     */
    private generateTypes(operations: OperationIR[]): string {
        if (!this.options.typescript) {
            return '';
        }

        const types: string[] = [];

        for (const op of operations) {
            const opTypes = this.generateOperationTypes(op);
            if (opTypes) {
                types.push(opTypes);
            }
        }

        return types.join('\n\n');
    }

    /**
     * Generate TypeScript types for a single operation.
     */
    private generateOperationTypes(op: OperationIR): string {
        const lines: string[] = [];
        const pascalName = this.toPascalCase(op.name);

        // Request params type
        const pathParams = op.inputs.filter(i => i.source === 'path');
        if (pathParams.length > 0) {
            lines.push(`export interface ${pascalName}Params {`);
            for (const param of pathParams) {
                lines.push(`${this.indent}${param.name}: string;`);
            }
            lines.push('}');
            lines.push('');
        }

        // Query params type
        const queryParams = op.inputs.filter(i => i.source === 'query');
        if (queryParams.length > 0) {
            lines.push(`export interface ${pascalName}Query {`);
            for (const param of queryParams) {
                const optional = !param.required ? '?' : '';
                lines.push(`${this.indent}${param.name}${optional}: string;`);
            }
            lines.push('}');
            lines.push('');
        }

        // Request body type (if applicable)
        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            const bodyType = this.inferBodyType(op.body);
            lines.push(`export interface ${pascalName}Body {`);
            lines.push(`${this.indent}[key: string]: ${bodyType};`);
            lines.push('}');
            lines.push('');
        }

        // Response type
        if (op.outputs.length > 0) {
            lines.push(`export interface ${pascalName}Response {`);
            for (const output of op.outputs) {
                lines.push(`${this.indent}${output.name}: unknown;`);
            }
            lines.push('}');
            lines.push('');
        } else {
            lines.push(`export interface ${pascalName}Response {`);
            lines.push(`${this.indent}status: number;`);
            lines.push(`${this.indent}headers: Record<string, string>;`);
            lines.push(`${this.indent}body: unknown;`);
            lines.push('}');
            lines.push('');
        }

        // Combined request type
        lines.push(`export interface ${pascalName}Request {`);
        if (pathParams.length > 0) {
            lines.push(`${this.indent}params: ${pascalName}Params;`);
        }
        if (queryParams.length > 0) {
            lines.push(`${this.indent}query: ${pascalName}Query;`);
        }
        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            lines.push(`${this.indent}body: ${pascalName}Body;`);
        }
        const headerParams = op.inputs.filter(i => i.source === 'header');
        if (headerParams.length > 0) {
            lines.push(`${this.indent}headers: {`);
            for (const param of headerParams) {
                lines.push(`${this.indent}${this.indent}${this.toValidIdentifier(param.name)}?: string;`);
            }
            lines.push(`${this.indent}};`);
        }
        lines.push('}');

        return lines.join('\n');
    }

    /**
     * Generate implementation interfaces.
     */
    private generateImplInterfaces(operations: OperationIR[]): string {
        if (!this.options.generateImplementationHooks || !this.options.typescript) {
            return '';
        }

        const lines: string[] = [];

        for (const op of operations) {
            const pascalName = this.toPascalCase(op.name);

            if (this.options.generateDocs) {
                lines.push('/**');
                lines.push(` * Implementation hook for ${op.name}`);
                lines.push(` * @param request - The parsed request data`);
                lines.push(` * @returns The response data`);
                lines.push(' */');
            }

            const asyncPrefix = this.options.asyncHandlers ? 'Promise<' : '';
            const asyncSuffix = this.options.asyncHandlers ? '>' : '';

            lines.push(`export type ${pascalName}ImplFn = (request: ${pascalName}Request) => ${asyncPrefix}${pascalName}Response${asyncSuffix};`);
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Generate all handlers.
     */
    private generateHandlers(routes: GeneratedRoute[]): string {
        return routes.map(r => r.handlerCode).join('\n\n');
    }

    /**
     * Generate a single handler.
     */
    private generateHandler(op: OperationIR): string {
        const lines: string[] = [];
        const ts = this.options.typescript;
        const async = this.options.asyncHandlers;

        // JSDoc comment
        if (this.options.generateDocs) {
            lines.push('/**');
            lines.push(` * Handler for ${op.method.toUpperCase()} ${this.extractPath(op.urlTemplate)}`);
            lines.push(` * Operation: ${op.name}`);
            if (op.metadata.note) {
                lines.push(' * @note This operation requires confirmation');
            }
            lines.push(' */');
        }

        // Function signature
        const reqType = ts ? `: Request` : '';
        const resType = ts ? `: Response` : '';
        const nextType = ts ? `: NextFunction` : '';
        const asyncKeyword = async ? 'async ' : '';
        const exportKeyword = ts ? 'export ' : '';

        lines.push(`${exportKeyword}${asyncKeyword}function ${op.name}Handler(req${reqType}, res${resType}, next${nextType}) {`);

        // Try-catch wrapper for error handling
        if (this.options.generateErrorHandling) {
            lines.push(`${this.indent}try {`);
        }

        const bodyIndent = this.options.generateErrorHandling ? this.indent + this.indent : this.indent;

        // Extract parameters
        lines.push(`${bodyIndent}// Extract request parameters`);
        lines.push(...this.generateParameterExtraction(op, bodyIndent));
        lines.push('');

        // Validation (if enabled)
        if (this.options.generateValidation) {
            const validationCode = this.generateValidation(op, bodyIndent);
            if (validationCode) {
                lines.push(`${bodyIndent}// Validate request`);
                lines.push(validationCode);
                lines.push('');
            }
        }

        // Build request object
        lines.push(`${bodyIndent}// Build request object for implementation`);
        lines.push(...this.generateRequestObjectConstruction(op, bodyIndent));
        lines.push('');

        // Call implementation hook
        if (this.options.generateImplementationHooks) {
            lines.push(`${bodyIndent}// Call implementation`);
            const awaitKeyword = async ? 'await ' : '';
            lines.push(`${bodyIndent}const result = ${awaitKeyword}${op.name}Impl(request);`);
            lines.push('');
        } else {
            lines.push(`${bodyIndent}// TODO: Implement business logic here`);
            lines.push(`${bodyIndent}const result = { /* implement me */ };`);
            lines.push('');
        }

        // Send response
        lines.push(`${bodyIndent}// Send response`);
        lines.push(...this.generateResponseSending(op, bodyIndent));

        // Error handling catch block
        if (this.options.generateErrorHandling) {
            lines.push(`${this.indent}} catch (error) {`);
            lines.push(`${this.indent}${this.indent}next(error);`);
            lines.push(`${this.indent}}`);
        }

        lines.push('}');

        // Export for CommonJS if not TypeScript
        if (!ts) {
            lines.push('');
            lines.push(`module.exports.${op.name}Handler = ${op.name}Handler;`);
        }

        return lines.join('\n');
    }

    /**
     * Generate parameter extraction code.
     */
    private generateParameterExtraction(op: OperationIR, indent: string): string[] {
        const lines: string[] = [];
        const ts = this.options.typescript;
        const pascalName = this.toPascalCase(op.name);

        // Path parameters
        const pathParams = op.inputs.filter(i => i.source === 'path');
        if (pathParams.length > 0) {
            const paramNames = pathParams.map(p => p.name).join(', ');
            const typeAnnotation = ts ? ` as ${pascalName}Params` : '';
            lines.push(`${indent}const { ${paramNames} } = req.params${typeAnnotation};`);
        }

        // Query parameters
        const queryParams = op.inputs.filter(i => i.source === 'query');
        if (queryParams.length > 0) {
            const paramNames = queryParams.map(p => p.name).join(', ');
            const typeAnnotation = ts ? ` as unknown as ${pascalName}Query` : '';
            lines.push(`${indent}const { ${paramNames} } = req.query${typeAnnotation};`);
        }

        // Header parameters
        const headerParams = op.inputs.filter(i => i.source === 'header');
        for (const param of headerParams) {
            const varName = this.toValidIdentifier(param.name);
            const headerName = param.name.toLowerCase();
            const typeAnnotation = ts ? ' as string | undefined' : '';
            lines.push(`${indent}const ${varName} = req.get('${headerName}')${typeAnnotation};`);
        }

        // Body
        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            const typeAnnotation = ts ? ` as ${pascalName}Body` : '';
            lines.push(`${indent}const body = req.body${typeAnnotation};`);
        }

        return lines;
    }

    /**
     * Generate validation code.
     */
    private generateValidation(op: OperationIR, indent: string): string {
        const lines: string[] = [];

        // Validate required path parameters
        const pathParams = op.inputs.filter(i => i.source === 'path' && i.required);
        for (const param of pathParams) {
            lines.push(`${indent}if (!${param.name}) {`);
            lines.push(`${indent}${this.indent}return res.status(400).json({ error: 'Missing required parameter: ${param.name}' });`);
            lines.push(`${indent}}`);
        }

        // Validate required query parameters
        const queryParams = op.inputs.filter(i => i.source === 'query' && i.required);
        for (const param of queryParams) {
            lines.push(`${indent}if (!${param.name}) {`);
            lines.push(`${indent}${this.indent}return res.status(400).json({ error: 'Missing required query parameter: ${param.name}' });`);
            lines.push(`${indent}}`);
        }

        // Validate required headers
        const headerParams = op.inputs.filter(i => i.source === 'header' && i.required);
        for (const param of headerParams) {
            const varName = this.toValidIdentifier(param.name);
            lines.push(`${indent}if (!${varName}) {`);
            lines.push(`${indent}${this.indent}return res.status(400).json({ error: 'Missing required header: ${param.name}' });`);
            lines.push(`${indent}}`);
        }

        // Validate body if required
        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            lines.push(`${indent}if (!body || Object.keys(body).length === 0) {`);
            lines.push(`${indent}${this.indent}return res.status(400).json({ error: 'Request body is required' });`);
            lines.push(`${indent}}`);
        }

        return lines.join('\n');
    }

    /**
     * Generate request object construction.
     */
    private generateRequestObjectConstruction(op: OperationIR, indent: string): string[] {
        const lines: string[] = [];
        const ts = this.options.typescript;
        const pascalName = this.toPascalCase(op.name);

        const typeAnnotation = ts ? `: ${pascalName}Request` : '';
        lines.push(`${indent}const request${typeAnnotation} = {`);

        const pathParams = op.inputs.filter(i => i.source === 'path');
        if (pathParams.length > 0) {
            const paramObj = pathParams.map(p => p.name).join(', ');
            lines.push(`${indent}${this.indent}params: { ${paramObj} },`);
        }

        const queryParams = op.inputs.filter(i => i.source === 'query');
        if (queryParams.length > 0) {
            const paramObj = queryParams.map(p => p.name).join(', ');
            lines.push(`${indent}${this.indent}query: { ${paramObj} },`);
        }

        if (op.body.kind !== 'none' && this.methodSupportsBody(op.method)) {
            lines.push(`${indent}${this.indent}body,`);
        }

        const headerParams = op.inputs.filter(i => i.source === 'header');
        if (headerParams.length > 0) {
            lines.push(`${indent}${this.indent}headers: {`);
            for (const param of headerParams) {
                const varName = this.toValidIdentifier(param.name);
                lines.push(`${indent}${this.indent}${this.indent}${varName},`);
            }
            lines.push(`${indent}${this.indent}},`);
        }

        lines.push(`${indent}};`);

        return lines;
    }

    /**
     * Generate response sending code.
     */
    private generateResponseSending(op: OperationIR, indent: string): string[] {
        const lines: string[] = [];

        if (op.outputs.length > 0) {
            // Return structured response based on outputs
            lines.push(`${indent}res.json(result);`);
        } else {
            // Return generic envelope
            lines.push(`${indent}if (result.status) {`);
            lines.push(`${indent}${this.indent}res.status(result.status);`);
            lines.push(`${indent}}`);
            lines.push(`${indent}if (result.headers) {`);
            lines.push(`${indent}${this.indent}res.set(result.headers);`);
            lines.push(`${indent}}`);
            lines.push(`${indent}res.json(result.body ?? result);`);
        }

        return lines;
    }

    /**
     * Generate route registrations.
     */
    private generateRouteRegistrations(routes: GeneratedRoute[]): string {
        const lines: string[] = [];
        const ts = this.options.typescript;
        const routerVar = this.options.routeStyle === 'router' ? 'router' : 'app';

        if (this.options.routeStyle === 'router') {
            lines.push(`${ts ? 'export ' : ''}const router = Router();`);
            lines.push('');
        }

        for (const route of routes) {
            if (this.options.generateDocs) {
                lines.push(`// ${route.method.toUpperCase()} ${route.path} - ${route.operationName}`);
            }
            lines.push(`${routerVar}.${route.method}('${route.path}', ${route.operationName}Handler);`);
        }

        if (this.options.routeStyle === 'router') {
            lines.push('');
            if (!ts) {
                lines.push('module.exports.router = router;');
            }
        }

        return lines.join('\n');
    }

    /**
     * Infer body type from BodySpec.
     */
    private inferBodyType(body: BodySpec): string {
        if (!body.mediaType) {
            return 'unknown';
        }

        if (body.mediaType.includes('json')) {
            return 'unknown';
        }

        if (body.mediaType.includes('xml')) {
            return 'string';
        }

        if (body.mediaType.includes('form')) {
            return 'unknown';
        }

        return 'unknown';
    }

    /**
     * Check if HTTP method supports request body.
     */
    private methodSupportsBody(method: string): boolean {
        const upper = method.toUpperCase();
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upper);
    }

    /**
     * Convert string to PascalCase.
     */
    private toPascalCase(str: string): string {
        return str
            .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
            .replace(/^(.)/, (_, c) => c.toUpperCase());
    }

    /**
     * Convert string to valid JavaScript identifier.
     */
    private toValidIdentifier(str: string): string {
        // Replace hyphens and other invalid chars
        return str
            .replace(/-/g, '_')
            .replace(/[^a-zA-Z0-9_$]/g, '_')
            .replace(/^(\d)/, '_$1');
    }
}

// ============================================================================
// Implementation Stub Generator
// ============================================================================

/**
 * Generate implementation stubs for the impl module.
 */
export function generateImplementationStubs(
    fileIR: HttpFileIR,
    options: ExpressGeneratorOptions = {}
): string {
    const ts = options.typescript ?? true;
    const async = options.asyncHandlers ?? true;
    const lines: string[] = [];

    // Imports
    if (ts) {
        const typeImports = fileIR.operations
            .map(op => {
                const pascal = toPascalCase(op.name);
                return `${pascal}Request, ${pascal}Response`;
            })
            .join(', ');
        lines.push(`import { ${typeImports} } from './routes';`);
    }

    lines.push('');

    // Generate stub for each operation
    for (const op of fileIR.operations) {
        const pascalName = toPascalCase(op.name);
        const asyncKeyword = async ? 'async ' : '';
        const returnType = ts ? `: Promise<${pascalName}Response>` : '';
        const reqType = ts ? `: ${pascalName}Request` : '';

        lines.push('/**');
        lines.push(` * Implementation for ${op.name}`);
        lines.push(' * TODO: Implement business logic');
        lines.push(' */');
        lines.push(`export ${asyncKeyword}function ${op.name}Impl(request${reqType})${returnType} {`);

        if (op.outputs.length > 0) {
            lines.push('  // TODO: Implement and return response with:');
            for (const output of op.outputs) {
                lines.push(`  // - ${output.name}`);
            }
            lines.push('  return {');
            for (const output of op.outputs) {
                lines.push(`    ${output.name}: undefined, // TODO`);
            }
            lines.push('  };');
        } else {
            lines.push('  // TODO: Implement and return response');
            lines.push('  return {');
            lines.push('    status: 200,');
            lines.push("    headers: {},");
            lines.push('    body: { /* TODO */ },');
            lines.push('  };');
        }

        lines.push('}');
        lines.push('');
    }

    return lines.join('\n');
}

// Helper function (module-level)
function toPascalCase(str: string): string {
    return str
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase());
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Generate Express routes and handlers from HttpFileIR.
 */
export function generateExpressApp(
    fileIR: HttpFileIR,
    options?: ExpressGeneratorOptions
): GeneratedExpressApp {
    const generator = new ExpressGenerator(options);
    return generator.generate(fileIR);
}

/**
 * Generate Express route code as a string.
 */
export function generateExpressRoutes(
    fileIR: HttpFileIR,
    options?: ExpressGeneratorOptions
): string {
    const result = generateExpressApp(fileIR, options);
    return result.fullContent;
}

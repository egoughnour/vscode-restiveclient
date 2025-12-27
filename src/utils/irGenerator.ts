/**
 * IR Generator
 *
 * Converts .http file content into OperationIR without executing requests.
 * This is the bridge between .http files and code generation (OpenAPI, Express, TypeSpec).
 */

import { EOL } from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
    OperationIR,
    HttpFileIR,
    BodySpec,
    BodyStage,
    InputBinding,
    InputBindingSource,
    OutputBinding,
    OperationMetadata,
} from './operationIR';
import { TemplateOrder } from './bodyPatchPipeline';
import { parseJsonPatchHeaderValue, JsonPatchRule } from './jsonPathBodyPatcher';

// Constants (replicated from constants.ts to avoid VS Code dependency)
const LineSplitterRegex = /\r?\n/g;
const RequestMetadataRegex = /^\s*(?:#|\/{2})\s*@([\w-]+)(?:\s+(.*?))?\s*$/;
const CommentIdentifiersRegex = /^\s*(#|\/{2})/;
const FileVariableDefinitionRegex = /^\s*@([^\s=]+)\s*=\s*(.*?)\s*$/;
const RequestVariableDefinitionRegex = /^\s*(?:#{1,}|\/{2,})\s+@name\s+(\w+)\s*$/m;
const PromptCommentRegex = /^\s*(?:#{1,}|\/{2,})\s*@prompt\s+([^\s]+)(?:\s+(.*))?\s*$/;
const BlockDelimiterRegex = /^#{3,}/;
const CommentBlockStartRegex = /^\s*(?:#|\/{2})\s*@block\s+(.+?)\s*$/;
const CommentBlockEndRegex = /^\s*(?:#|\/{2})\s*@end\s*$/;

// Variable pattern matching
const VariableReferenceRegex = /\{{2}([^{}]+)\}{2}/g;
const RequestVariableReferenceRegex = /^(\w+)\.(response|request)(?:\.(body|headers)(?:\.(.*))?)?$/;
const SystemVariableRegex = /^\$(\w+)(?:\s+(.*))?$/;

// HTTP methods
const HttpMethods = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|LOCK|UNLOCK|PROPFIND|PROPPATCH|COPY|MOVE|MKCOL|MKCALENDAR|ACL|SEARCH)\s+/i;

// File body indicator syntax
const InputFileSyntax = /^<(?=[\s@jx\.])(?:(?<indicator>[^\s]+)\s+)?(?<filepath>.+?)\s*$/;

// Patch header names (configurable, but we use defaults)
const JsonPatchHeaderName = 'x-restiveclient-jsonpatch';
const XmlPatchHeaderName = 'x-restiveclient-xmlpatch';

/**
 * Parse state machine for request parsing.
 */
enum ParseState {
    URL,
    Header,
    Body,
}

/**
 * Configuration options for the IR generator.
 */
export interface IRGeneratorOptions {
    /** Base path for resolving relative file references */
    basePath?: string;
    /** Whether to load file contents for file-based bodies */
    loadFileContents?: boolean;
    /** Custom JSON patch header name */
    jsonPatchHeaderName?: string;
    /** Custom XML patch header name */
    xmlPatchHeaderName?: string;
}

/**
 * Represents a parsed request block before IR conversion.
 */
interface ParsedRequestBlock {
    /** Lines before the request (comments, metadata) */
    preLines: string[];
    /** The request line (method + URL) */
    requestLine: string;
    /** Header lines */
    headerLines: string[];
    /** Body lines */
    bodyLines: string[];
    /** Lines after the body (for output extraction) */
    postLines: string[];
    /** Raw text of the entire block */
    rawText: string;
}

/**
 * Main IR generator class.
 */
export class IRGenerator {
    private readonly options: Required<IRGeneratorOptions>;

    constructor(options: IRGeneratorOptions = {}) {
        this.options = {
            basePath: options.basePath ?? process.cwd(),
            loadFileContents: options.loadFileContents ?? true,
            jsonPatchHeaderName: options.jsonPatchHeaderName ?? JsonPatchHeaderName,
            xmlPatchHeaderName: options.xmlPatchHeaderName ?? XmlPatchHeaderName,
        };
    }

    /**
     * Parse an entire .http file into HttpFileIR.
     */
    async parseHttpFile(content: string): Promise<HttpFileIR> {
        const lines = content.split(LineSplitterRegex);
        const blocks = this.splitIntoBlocks(lines);
        const fileVariables = this.extractFileVariables(lines);
        const operations: OperationIR[] = [];
        const warnings: string[] = [];

        for (const block of blocks) {
            const parsed = this.parseBlock(block);
            if (!parsed) {
                continue;
            }

            // Extract metadata to get the @name
            const metadata = this.parseMetadata(parsed.preLines);
            if (!metadata.name) {
                // Only process named requests as operations
                continue;
            }

            try {
                const ir = await this.blockToIR(parsed, metadata);
                operations.push(ir);
            } catch (e) {
                warnings.push(`Error parsing operation "${metadata.name}": ${String(e)}`);
            }
        }

        return { operations, fileVariables, warnings };
    }

    /**
     * Parse a single request block into OperationIR.
     * Useful when you already have a selected request text.
     */
    async parseRequest(requestText: string, name?: string): Promise<OperationIR | null> {
        const lines = requestText.split(LineSplitterRegex);
        const block = { lines, startLine: 0, endLine: lines.length - 1 };
        const parsed = this.parseBlock(block);
        if (!parsed) {
            return null;
        }

        const metadata = this.parseMetadata(parsed.preLines);
        if (name) {
            metadata.name = name;
        }
        if (!metadata.name) {
            return null;
        }

        return this.blockToIR(parsed, metadata);
    }

    /**
     * Split file content into blocks delimited by ###.
     */
    private splitIntoBlocks(lines: string[]): Array<{ lines: string[]; startLine: number; endLine: number }> {
        const blocks: Array<{ lines: string[]; startLine: number; endLine: number }> = [];
        const delimiterLines: number[] = [];

        // Find all delimiter lines
        for (let i = 0; i < lines.length; i++) {
            if (BlockDelimiterRegex.test(lines[i])) {
                delimiterLines.push(i);
            }
        }

        if (delimiterLines.length === 0) {
            // No delimiters - entire file is one block
            return [{ lines, startLine: 0, endLine: lines.length - 1 }];
        }

        // First block (before first delimiter)
        if (delimiterLines[0] > 0) {
            blocks.push({
                lines: lines.slice(0, delimiterLines[0]),
                startLine: 0,
                endLine: delimiterLines[0] - 1,
            });
        }

        // Blocks between delimiters
        for (let i = 0; i < delimiterLines.length; i++) {
            const start = delimiterLines[i] + 1;
            const end = i < delimiterLines.length - 1 ? delimiterLines[i + 1] - 1 : lines.length - 1;
            if (start <= end) {
                blocks.push({
                    lines: lines.slice(start, end + 1),
                    startLine: start,
                    endLine: end,
                });
            }
        }

        return blocks;
    }

    /**
     * Parse a block into its components (pre-lines, request, headers, body, post-lines).
     */
    private parseBlock(block: { lines: string[]; startLine: number; endLine: number }): ParsedRequestBlock | null {
        const { lines } = block;
        const preLines: string[] = [];
        const headerLines: string[] = [];
        const bodyLines: string[] = [];
        const postLines: string[] = [];
        let requestLine = '';

        let state = ParseState.URL;
        let foundRequest = false;
        let bodyStarted = false;
        let insideCommentBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            switch (state) {
                case ParseState.URL:
                    if (this.isCommentLine(line) || this.isEmptyLine(line) || this.isFileVariableLine(line)) {
                        preLines.push(line);
                    } else {
                        // This should be the request line
                        requestLine = trimmed;
                        foundRequest = true;
                        // Handle query string continuation lines
                        while (i + 1 < lines.length && this.looksLikeQueryContinuation(lines[i + 1])) {
                            i++;
                            requestLine += lines[i].trim();
                        }
                        // Check next line to determine state
                        const nextLine = lines[i + 1];
                        if (nextLine === undefined) {
                            // No more lines
                            state = ParseState.Body;
                        } else if (nextLine.trim() === '') {
                            // Empty line means body follows
                            state = ParseState.Body;
                        } else {
                            state = ParseState.Header;
                        }
                    }
                    break;

                case ParseState.Header:
                    if (CommentBlockStartRegex.test(line)) {
                        insideCommentBlock = true;
                        postLines.push(line);
                        continue;
                    }
                    if (insideCommentBlock) {
                        postLines.push(line);
                        if (CommentBlockEndRegex.test(line)) {
                            insideCommentBlock = false;
                        }
                        continue;
                    }
                    if (CommentBlockEndRegex.test(line)) {
                        postLines.push(line);
                        continue;
                    }
                    if (trimmed === '') {
                        state = ParseState.Body;
                    } else if (this.isCommentLine(line)) {
                        postLines.push(line);
                    } else {
                        headerLines.push(trimmed);
                    }
                    break;

                case ParseState.Body:
                    if (CommentBlockStartRegex.test(line)) {
                        insideCommentBlock = true;
                        postLines.push(line);
                        continue;
                    }
                    if (insideCommentBlock) {
                        postLines.push(line);
                        if (CommentBlockEndRegex.test(line)) {
                            insideCommentBlock = false;
                        }
                        continue;
                    }
                    if (CommentBlockEndRegex.test(line)) {
                        postLines.push(line);
                        continue;
                    }
                    if (!bodyStarted && trimmed === '') {
                        // Skip leading empty lines after headers
                        continue;
                    }
                    bodyStarted = true;
                    bodyLines.push(line);
                    break;
            }
        }

        if (!foundRequest) {
            return null;
        }

        // Handle query continuation lines that were part of the URL
        while (headerLines.length > 0 && this.looksLikeQueryContinuation(headerLines[0])) {
            requestLine += headerLines.shift()!.trim();
        }

        return {
            preLines,
            requestLine,
            headerLines,
            bodyLines,
            postLines,
            rawText: lines.join(EOL),
        };
    }

    /**
     * Convert a parsed block into OperationIR.
     */
    private async blockToIR(
        parsed: ParsedRequestBlock,
        metadata: { name: string; operationMetadata: OperationMetadata }
    ): Promise<OperationIR> {
        // Parse request line
        const { method, url } = this.parseRequestLine(parsed.requestLine);

        // Parse headers
        const headers = this.parseHeaders(parsed.headerLines);

        // Extract patch rules from headers
        const jsonPatchHeader = this.getHeaderCaseInsensitive(headers, this.options.jsonPatchHeaderName);
        const xmlPatchHeader = this.getHeaderCaseInsensitive(headers, this.options.xmlPatchHeaderName);

        const jsonRules = jsonPatchHeader ? parseJsonPatchHeaderValue([jsonPatchHeader]) : [];
        const xmlRules = xmlPatchHeader ? parseJsonPatchHeaderValue([xmlPatchHeader]) : [];

        // Parse body
        const body = await this.parseBody(
            parsed.bodyLines,
            headers['content-type'] as string | undefined,
            jsonRules,
            xmlRules
        );

        // Collect all inputs
        const inputs = this.extractInputs(url, headers, body, jsonRules, xmlRules);

        // Extract outputs from all lines in the block (pre, body, post)
        const allBlockLines = [...parsed.preLines, ...parsed.bodyLines, ...parsed.postLines];
        const outputs = this.extractOutputs(allBlockLines, metadata.name);

        const commentBlocks = this.extractCommentBlocks(parsed.rawText.split(LineSplitterRegex));

        // Find dependencies (other operations referenced)
        const dependencies = this.extractDependencies(url, headers, body, jsonRules, xmlRules);

        return {
            name: metadata.name,
            method,
            urlTemplate: url,
            headers: this.headersToRecord(headers),
            body,
            inputs,
            outputs,
            commentBlocks: commentBlocks.length > 0 ? commentBlocks : undefined,
            dependencies,
            metadata: metadata.operationMetadata,
            rawText: parsed.rawText,
        };
    }

    /**
     * Parse the request line into method and URL.
     */
    private parseRequestLine(line: string): { method: string; url: string } {
        let method = 'GET';
        let url = line;

        const methodMatch = HttpMethods.exec(line);
        if (methodMatch) {
            method = methodMatch[1].toUpperCase();
            url = line.slice(methodMatch[0].length);
        }

        // Remove HTTP version suffix if present
        url = url.replace(/\s+HTTP\/[\d.]+\s*$/i, '').trim();

        return { method, url };
    }

    /**
     * Parse header lines into a headers object.
     */
    private parseHeaders(headerLines: string[]): Record<string, string> {
        const headers: Record<string, string> = {};

        for (const line of headerLines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex < 0) {
                continue;
            }

            const name = line.slice(0, colonIndex).trim();
            const value = line.slice(colonIndex + 1).trim();
            const nameLower = name.toLowerCase();

            if (headers[nameLower]) {
                // Merge multiple values
                if (nameLower === 'cookie') {
                    headers[nameLower] += '; ' + value;
                } else {
                    headers[nameLower] += ', ' + value;
                }
            } else {
                headers[nameLower] = value;
            }
        }

        return headers;
    }

    /**
     * Parse body lines into BodySpec.
     */
    private async parseBody(
        bodyLines: string[],
        contentType: string | undefined,
        jsonRules: JsonPatchRule[],
        xmlRules: JsonPatchRule[]
    ): Promise<BodySpec> {
        if (bodyLines.length === 0) {
            return {
                kind: 'none',
                mediaType: contentType,
                pipeline: [],
            };
        }

        // Check for file body indicator
        const firstLine = bodyLines[0];
        const fileMatch = InputFileSyntax.exec(firstLine);

        if (fileMatch?.groups) {
            const indicator = fileMatch.groups.indicator;
            const filepath = fileMatch.groups.filepath.trim();
            const { pipeline } = this.parseIndicator(indicator, jsonRules, xmlRules);

            let rawBodyTemplate: string | undefined;
            if (this.options.loadFileContents) {
                try {
                    const fullPath = path.resolve(this.options.basePath, filepath);
                    rawBodyTemplate = await fs.readFile(fullPath, 'utf8');
                } catch {
                    // File not found or not readable
                }
            }

            return {
                kind: 'file',
                mediaType: contentType,
                fileRef: filepath,
                rawBodyTemplate,
                pipeline,
                patch: jsonRules.length || xmlRules.length ? { jsonRules, xmlRules } : undefined,
            };
        }

        // Inline body
        const rawBodyTemplate = bodyLines.join(EOL);
        const pipeline = this.buildDefaultPipeline(jsonRules, xmlRules);

        return {
            kind: 'inline',
            mediaType: contentType,
            rawBodyTemplate,
            pipeline,
            patch: jsonRules.length || xmlRules.length ? { jsonRules, xmlRules } : undefined,
        };
    }

    /**
     * Parse file indicator to determine template order and build pipeline.
     */
    private parseIndicator(
        indicator: string | undefined,
        jsonRules: JsonPatchRule[],
        xmlRules: JsonPatchRule[]
    ): { templateOrder: TemplateOrder; pipeline: BodyStage[] } {
        if (!indicator) {
            return { templateOrder: TemplateOrder.None, pipeline: this.buildDefaultPipeline(jsonRules, xmlRules) };
        }

        if (indicator === '.') {
            // Forbid template processing
            return { templateOrder: TemplateOrder.None, pipeline: this.buildPatchOnlyPipeline(jsonRules, xmlRules) };
        }

        const atIndex = indicator.indexOf('@');
        if (atIndex === -1) {
            return { templateOrder: TemplateOrder.None, pipeline: this.buildDefaultPipeline(jsonRules, xmlRules) };
        }

        const before = indicator.slice(0, atIndex);
        // Pattern: j@ or x@ means patch before template
        if (before === 'j' || before === 'x') {
            const pipeline: BodyStage[] = [];
            if (jsonRules.length) {
                pipeline.push({ type: 'jsonPatch', rules: jsonRules });
            }
            if (xmlRules.length) {
                pipeline.push({ type: 'xmlPatch', rules: xmlRules });
            }
            pipeline.push({ type: 'template' });
            return { templateOrder: TemplateOrder.AfterPatch, pipeline };
        }

        // Pattern: @j or @x or just @ means template before patch
        const pipeline: BodyStage[] = [{ type: 'template' }];
        if (jsonRules.length) {
            pipeline.push({ type: 'jsonPatch', rules: jsonRules });
        }
        if (xmlRules.length) {
            pipeline.push({ type: 'xmlPatch', rules: xmlRules });
        }
        return { templateOrder: TemplateOrder.BeforePatch, pipeline };
    }

    /**
     * Build default pipeline (template before patch).
     */
    private buildDefaultPipeline(jsonRules: JsonPatchRule[], xmlRules: JsonPatchRule[]): BodyStage[] {
        const pipeline: BodyStage[] = [{ type: 'template' }];
        if (jsonRules.length) {
            pipeline.push({ type: 'jsonPatch', rules: jsonRules });
        }
        if (xmlRules.length) {
            pipeline.push({ type: 'xmlPatch', rules: xmlRules });
        }
        return pipeline;
    }

    /**
     * Build patch-only pipeline (no template).
     */
    private buildPatchOnlyPipeline(jsonRules: JsonPatchRule[], xmlRules: JsonPatchRule[]): BodyStage[] {
        const pipeline: BodyStage[] = [];
        if (jsonRules.length) {
            pipeline.push({ type: 'jsonPatch', rules: jsonRules });
        }
        if (xmlRules.length) {
            pipeline.push({ type: 'xmlPatch', rules: xmlRules });
        }
        return pipeline;
    }

    /**
     * Extract all input bindings from the request.
     */
    private extractInputs(
        url: string,
        headers: Record<string, string>,
        body: BodySpec,
        jsonRules: JsonPatchRule[],
        xmlRules: JsonPatchRule[]
    ): InputBinding[] {
        const inputs: InputBinding[] = [];
        const seen = new Set<string>();

        // Helper to add an input
        const addInput = (
            varExpr: string,
            source: InputBindingSource,
            rawExpression: string
        ) => {
            const key = `${varExpr}:${source}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);

            const binding = this.classifyVariable(varExpr, source, rawExpression);
            if (binding) {
                inputs.push(binding);
            }
        };

        // Extract from URL
        const urlVars = this.findVariables(url);
        for (const v of urlVars) {
            // Determine if path or query by checking position relative to ?
            const queryStart = url.indexOf('?');
            const varPosition = url.indexOf(v.full);
            const isQuery = queryStart >= 0 && varPosition > queryStart;
            const source: InputBindingSource = isQuery ? 'query' : 'path';
            addInput(v.inner, source, v.full);
        }

        // Extract from headers (excluding patch directive headers)
        for (const [name, value] of Object.entries(headers)) {
            if (name === this.options.jsonPatchHeaderName || name === this.options.xmlPatchHeaderName) {
                continue;
            }
            const vars = this.findVariables(value);
            for (const v of vars) {
                addInput(v.inner, 'header', v.full);
            }
        }

        // Extract from body template
        if (body.rawBodyTemplate) {
            const vars = this.findVariables(body.rawBodyTemplate);
            for (const v of vars) {
                addInput(v.inner, 'body', v.full);
            }
        }

        // Extract from patch rule RHS values
        for (const rule of [...jsonRules, ...xmlRules]) {
            const vars = this.findVariables(rule.rawValue);
            for (const v of vars) {
                addInput(v.inner, 'body', v.full);
            }
        }

        return inputs;
    }

    /**
     * Extract output bindings from all lines in the block.
     * Outputs are @var = {{opName.response...}} assignments that reference this operation.
     */
    private extractOutputs(
        allBlockLines: string[],
        opName: string
    ): OutputBinding[] {
        const outputs: OutputBinding[] = [];

        for (const line of allBlockLines) {
            // Skip comment lines
            if (this.isCommentLine(line)) {
                continue;
            }

            const match = FileVariableDefinitionRegex.exec(line);
            if (!match) {
                continue;
            }

            const varName = match[1];
            const value = match[2];

            // Check if it references this operation's response
            const varRefRegex = new RegExp(VariableReferenceRegex.source, 'g');
            let varMatch: RegExpExecArray | null;
            while ((varMatch = varRefRegex.exec(value)) !== null) {
                const inner = varMatch[1];
                const reqVarMatch = RequestVariableReferenceRegex.exec(inner);
                if (!reqVarMatch) {
                    continue;
                }

                const referencedOp = reqVarMatch[1];
                const entity = reqVarMatch[2]; // 'response' or 'request'
                const part = reqVarMatch[3]; // 'body' or 'headers'
                const selector = reqVarMatch[4]; // the path/header name

                // Only consider it an output if it references this operation's response
                if (referencedOp !== opName || entity !== 'response') {
                    continue;
                }

                outputs.push({
                    name: varName,
                    source: part === 'headers' ? 'headers' : 'body',
                    selector: selector || '',
                    rawExpression: value,
                });
            }
        }

        return outputs;
    }

    /**
     * Extract comment-only instruction blocks from a request block.
     * Uses @block <name> ... @end markers in comment lines.
     */
    private extractCommentBlocks(lines: string[]): Array<{ name: string; lines: string[]; content: string }> {
        const blocks: Array<{ name: string; lines: string[]; content: string }> = [];
        let current: { name: string; lines: string[] } | null = null;

        for (const line of lines) {
            const startMatch = CommentBlockStartRegex.exec(line);
            if (startMatch) {
                if (current) {
                    blocks.push({
                        name: current.name,
                        lines: current.lines,
                        content: current.lines.join(EOL),
                    });
                }
                current = { name: startMatch[1].trim(), lines: [] };
                continue;
            }

            if (CommentBlockEndRegex.test(line)) {
                if (current) {
                    blocks.push({
                        name: current.name,
                        lines: current.lines,
                        content: current.lines.join(EOL),
                    });
                }
                current = null;
                continue;
            }

            if (current) {
                current.lines.push(this.stripCommentPrefix(line));
            }
        }

        if (current) {
            blocks.push({
                name: current.name,
                lines: current.lines,
                content: current.lines.join(EOL),
            });
        }

        return blocks;
    }

    /**
     * Extract dependencies (other operations referenced via {{other.response...}}).
     */
    private extractDependencies(
        url: string,
        headers: Record<string, string>,
        body: BodySpec,
        jsonRules: JsonPatchRule[],
        xmlRules: JsonPatchRule[]
    ): string[] {
        const deps = new Set<string>();

        // Collect all variable references
        const allText = [
            url,
            ...Object.values(headers),
            body.rawBodyTemplate || '',
            ...jsonRules.map(r => r.rawValue),
            ...xmlRules.map(r => r.rawValue),
        ].join('\n');

        const vars = this.findVariables(allText);
        for (const v of vars) {
            const reqMatch = RequestVariableReferenceRegex.exec(v.inner);
            if (reqMatch) {
                deps.add(reqMatch[1]);
            }
        }

        return Array.from(deps);
    }

    /**
     * Parse metadata from pre-lines.
     */
    private parseMetadata(preLines: string[]): { name: string; operationMetadata: OperationMetadata } {
        let name = '';
        const operationMetadata: OperationMetadata = {};
        const prompts: Array<{ name: string; description?: string }> = [];

        for (const line of preLines) {
            const match = RequestMetadataRegex.exec(line);
            if (!match) {
                continue;
            }

            const metaKey = match[1].toLowerCase();
            const metaValue = match[2]?.trim();

            switch (metaKey) {
                case 'name':
                    name = metaValue || '';
                    break;
                case 'note':
                    operationMetadata.note = true;
                    break;
                case 'no-redirect':
                    operationMetadata.noRedirect = true;
                    break;
                case 'no-cookie-jar':
                    operationMetadata.noCookieJar = true;
                    break;
                case 'prompt':
                    const promptMatch = PromptCommentRegex.exec(line);
                    if (promptMatch) {
                        prompts.push({
                            name: promptMatch[1],
                            description: promptMatch[2],
                        });
                    }
                    break;
            }
        }

        if (prompts.length > 0) {
            operationMetadata.prompts = prompts;
        }

        return { name, operationMetadata };
    }

    /**
     * Classify a variable expression into an InputBinding.
     */
    private classifyVariable(
        varExpr: string,
        source: InputBindingSource,
        rawExpression: string
    ): InputBinding | null {
        // Check for system variable
        const systemMatch = SystemVariableRegex.exec(varExpr);
        if (systemMatch) {
            const systemType = systemMatch[1];
            // $processEnv and $dotenv are config variables
            if (systemType === 'processEnv' || systemType === 'dotenv') {
                const envVar = systemMatch[2]?.trim();
                return {
                    name: envVar || systemType,
                    source: 'config',
                    rawExpression,
                    required: false,
                    systemType,
                };
            }
            // Other system variables
            return {
                name: varExpr,
                source: 'system',
                rawExpression,
                required: false,
                systemType,
            };
        }

        // Check for request variable reference (dependency)
        const reqMatch = RequestVariableReferenceRegex.exec(varExpr);
        if (reqMatch) {
            // This is a derived variable from another request - not an input
            return null;
        }

        // Plain variable - this is a required input
        return {
            name: varExpr,
            source,
            rawExpression,
            required: true,
        };
    }

    /**
     * Find all {{...}} variable references in text.
     */
    private findVariables(text: string): Array<{ full: string; inner: string }> {
        const results: Array<{ full: string; inner: string }> = [];
        let match: RegExpExecArray | null;
        const regex = new RegExp(VariableReferenceRegex.source, 'g');
        while ((match = regex.exec(text)) !== null) {
            results.push({ full: match[0], inner: match[1] });
        }
        return results;
    }

    /**
     * Extract file-level variable definitions.
     */
    private extractFileVariables(lines: string[]): Record<string, string> {
        const vars: Record<string, string> = {};

        for (const line of lines) {
            // Skip if inside a request block (after a non-comment, non-empty line)
            if (BlockDelimiterRegex.test(line)) {
                continue;
            }

            const match = FileVariableDefinitionRegex.exec(line);
            if (match && !this.isCommentLine(line)) {
                // File variables are @name = value lines at file level
                // We need to distinguish from request variables which are # @name varname
                if (!RequestVariableDefinitionRegex.test(line)) {
                    vars[match[1]] = match[2];
                }
            }
        }

        return vars;
    }

    /**
     * Convert headers record to Record<string, string>.
     */
    private headersToRecord(headers: Record<string, string>): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
            // Skip patch directive headers from the output
            if (key === this.options.jsonPatchHeaderName || key === this.options.xmlPatchHeaderName) {
                continue;
            }
            result[key] = value;
        }
        return result;
    }

    /**
     * Get header value case-insensitively.
     */
    private getHeaderCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
        const nameLower = name.toLowerCase();
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === nameLower) {
                return value;
            }
        }
        return undefined;
    }

    /**
     * Check if a line is a comment line.
     */
    private isCommentLine(line: string): boolean {
        return CommentIdentifiersRegex.test(line);
    }

    /**
     * Remove comment prefix from a line while preserving the remainder.
     */
    private stripCommentPrefix(line: string): string {
        const match = /^\s*(#|\/{2})\s?(.*)$/.exec(line);
        return match ? match[2] : line;
    }

    /**
     * Check if a line is empty.
     */
    private isEmptyLine(line: string): boolean {
        return line.trim() === '';
    }

    /**
     * Check if a line is a file variable definition.
     */
    private isFileVariableLine(line: string): boolean {
        return FileVariableDefinitionRegex.test(line) && !RequestVariableDefinitionRegex.test(line);
    }

    /**
     * Check if a line looks like query string continuation.
     */
    private looksLikeQueryContinuation(line: string): boolean {
        return /^\s*[&?]/.test(line);
    }
}

/**
 * Convenience function to parse a .http file.
 */
export async function parseHttpFileToIR(
    content: string,
    options?: IRGeneratorOptions
): Promise<HttpFileIR> {
    const generator = new IRGenerator(options);
    return generator.parseHttpFile(content);
}

/**
 * Convenience function to parse a single request.
 */
export async function parseRequestToIR(
    requestText: string,
    name: string,
    options?: IRGeneratorOptions
): Promise<OperationIR | null> {
    const generator = new IRGenerator(options);
    return generator.parseRequest(requestText, name);
}

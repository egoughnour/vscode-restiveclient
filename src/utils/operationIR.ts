/**
 * Operation IR (Intermediate Representation)
 *
 * This module defines the stable intermediate representation that can be derived
 * from a .http file without executing the request. This IR drives:
 * - OpenAPI YAML generation (server contract)
 * - Express route + handler generation (implementation scaffold)
 * - Optional SDK method generation
 * - Optional TypeSpec generation
 */

import { TemplateOrder } from './bodyPatchPipeline';

/**
 * A patch rule parsed from X-RestiveClient-JsonPatch or X-RestiveClient-XmlPatch headers.
 */
export interface PatchRule {
    /** The selector path (JSONPath for JSON, XPath for XML) */
    path: string;
    /** The raw value, which may contain template variables */
    rawValue: string;
}

/**
 * Represents a stage in the body evaluation pipeline.
 * The order of stages determines the processing sequence.
 */
export type BodyStage =
    | { type: 'template' }        // Variable substitution stage
    | { type: 'jsonPatch'; rules: PatchRule[] }  // JSON patching stage
    | { type: 'xmlPatch'; rules: PatchRule[] };  // XML patching stage

/**
 * Types of input bindings that can be inferred from a request.
 */
export type InputBindingSource =
    | 'path'          // URL path segment variable, e.g., {{userId}} in /users/{{userId}}
    | 'query'         // Query parameter variable
    | 'header'        // Header variable
    | 'body'          // Body variable (inline or from patch RHS)
    | 'config'        // Configuration variable from $processEnv or $dotenv
    | 'system';       // System variable like $timestamp, $guid

/**
 * An input binding represents a "hole" that must be supplied to materialize the request.
 */
export interface InputBinding {
    /** The variable name as it appears in the template */
    name: string;
    /** Where this input is used */
    source: InputBindingSource;
    /** The raw variable expression (e.g., "{{$processEnv API_KEY}}") */
    rawExpression: string;
    /** Whether this is a required input (non-system, non-config variables are required) */
    required: boolean;
    /** For system variables, the system variable type */
    systemType?: string;
}

/**
 * The source from which an output is extracted.
 */
export type OutputSource = 'body' | 'headers';

/**
 * An output binding represents a value extracted from the response.
 */
export interface OutputBinding {
    /** The variable name (from @foo = {{op.response...}}) */
    name: string;
    /** Whether extracting from body or headers */
    source: OutputSource;
    /** The selector expression (JSONPath, XPath, or header name) */
    selector: string;
    /** The raw expression from the assignment */
    rawExpression: string;
}

/**
 * Metadata flags parsed from request comments.
 */
export interface OperationMetadata {
    /** Whether # @note was specified (requires confirmation) */
    note?: boolean;
    /** Whether # @no-redirect was specified */
    noRedirect?: boolean;
    /** Whether # @no-cookie-jar was specified */
    noCookieJar?: boolean;
    /** Prompt variables defined with # @prompt */
    prompts?: Array<{ name: string; description?: string }>;
}

/**
 * Body kind indicates how the body is provided.
 */
export type BodyKind = 'none' | 'inline' | 'file';

/**
 * Body specification in the IR.
 */
export interface BodySpec {
    /** How the body content is provided */
    kind: BodyKind;
    /** Content-Type from headers */
    mediaType?: string;
    /** The raw body template content (inline text or loaded file contents) */
    rawBodyTemplate?: string;
    /** File reference path for file-based bodies */
    fileRef?: string;
    /** The ordered evaluation stages (template/patch) */
    pipeline: BodyStage[];
    /** Parsed patch rules from directive headers */
    patch?: {
        jsonRules?: PatchRule[];
        xmlRules?: PatchRule[];
    };
}

/**
 * The main Operation IR type representing a single HTTP operation.
 *
 * This can be derived without executing the request (codegen phase).
 * Execution artifacts (example responses) can optionally enrich types later.
 */
export interface OperationIR {
    /** Operation name from # @name directive */
    name: string;
    /** Optional descriptive title from comments */
    title?: string;
    /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) */
    method: string;
    /** URL template, may include {{vars}} */
    urlTemplate: string;
    /** Headers after parsing, before stripping directives */
    headers: Record<string, string>;
    /** Body specification */
    body: BodySpec;
    /** Inferred parameter list */
    inputs: InputBinding[];
    /** Inferred return fields */
    outputs: OutputBinding[];
    /** Other operations referenced via {{other.response...}} */
    dependencies: string[];
    /** Request metadata flags */
    metadata: OperationMetadata;
    /** The raw request text (for reference/debugging) */
    rawText?: string;
}

/**
 * Result of parsing an entire .http file into Operations.
 */
export interface HttpFileIR {
    /** All operations found in the file (those with @name) */
    operations: OperationIR[];
    /** File-level variables defined with @varname = value */
    fileVariables: Record<string, string>;
    /** Warnings encountered during parsing */
    warnings: string[];
}

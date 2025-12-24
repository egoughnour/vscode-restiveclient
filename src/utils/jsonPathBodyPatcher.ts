import { JSONPath } from 'jsonpath-plus';

export interface JsonPatchRule {
    path: string;
    rawValue: string;
}

export type VariableResolver = (text: string) => string | Promise<string>;

export function parseJsonPatchHeaderValue(headerValues: string[]): JsonPatchRule[] {
    if (!headerValues.length) {
        return [];
    }

    const joined = headerValues.join(';');
    const chunks: string[] = [];

    let current = '';
    let escaping = false;

    for (const ch of joined) {
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch === '\\') {
            escaping = true;
            continue;
        }
        if (ch === ';') {
            if (current.trim().length) {
                chunks.push(current.trim());
            }
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim().length) {
        chunks.push(current.trim());
    }

    const rules: JsonPatchRule[] = [];

    for (const chunk of chunks) {
        const eqIndex = findUnescapedEquals(chunk);
        if (eqIndex < 0) {
            // No '=', ignore
            continue;
        }

        const pathRaw = chunk.slice(0, eqIndex).trim();
        const valueRaw = chunk.slice(eqIndex + 1).trim();

        if (!pathRaw) {
            continue;
        }

        rules.push({
            path: pathRaw,
            rawValue: valueRaw
        });
    }

    return rules;
}

function findUnescapedEquals(s: string): number {
    let escaping = false;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let bracketDepth = 0;
    let parenDepth = 0;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (escaping) {
            escaping = false;
            continue;
        }
        if (ch === '\\') {
            escaping = true;
            continue;
        }

        // Track quote states
        if (ch === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        // Skip characters inside quotes
        if (inSingleQuote || inDoubleQuote) {
            continue;
        }

        // Track bracket/paren depth for JSONPath filter expressions
        if (ch === '[' || ch === '(') {
            if (ch === '[') bracketDepth++;
            if (ch === '(') parenDepth++;
            continue;
        }
        if (ch === ']' || ch === ')') {
            if (ch === ']' && bracketDepth > 0) bracketDepth--;
            if (ch === ')' && parenDepth > 0) parenDepth--;
            continue;
        }

        // Only match '=' when not inside brackets/parens or quotes
        if (ch === '=' && bracketDepth === 0 && parenDepth === 0) {
            return i;
        }
    }
    return -1;
}

export async function applyJsonPathPokes(
    jsonText: string,
    rules: JsonPatchRule[],
    resolveVariables: VariableResolver
): Promise<string> {
    if (!rules.length) {
        return jsonText;
    }

    let data: any;
    try {
        data = JSON.parse(jsonText);
    } catch (e) {
        throw new Error(
            `Restive Client JSON patch: body is not valid JSON: ${String(e)}`
        );
    }

    for (const rule of rules) {
        const resolvedText = await resolveVariables(rule.rawValue);
        const value = interpretValue(resolvedText);
        applyValueAtJsonPath(data, rule.path, value);
    }

    return JSON.stringify(data);
}

function interpretValue(text: string): any {
    const trimmed = text.trim();

    // Try JSON literal: object/array/number/bool/null
    if (
        trimmed.startsWith('{') ||
        trimmed.startsWith('[') ||
        trimmed === 'true' ||
        trimmed === 'false' ||
        trimmed === 'null' ||
        /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)
    ) {
        try {
            return JSON.parse(trimmed);
        } catch {
            // fall through to string handling
        }
    }

    // Quoted string
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    // Plain string
    return text;
}

function applyValueAtJsonPath(target: any, path: string, value: any): void {
    const pointers: string[] = JSONPath({
        path,
        json: target,
        resultType: 'pointer'
    }) as string[];

    for (const pointer of pointers) {
        setByJsonPointer(target, pointer, value);
    }
}

function setByJsonPointer(target: any, pointer: string, value: any): void {
    // JSON Pointer: "" (root), "/foo", "/foo/0/bar"
    if (!pointer || pointer === '') {
        // You can decide to forbid this; here we treat it as replacing the root object
        if (value && typeof value === 'object') {
            for (const key of Object.keys(target)) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete (target as any)[key];
            }
            Object.assign(target, value);
            return;
        } else {
            throw new Error(
                'Restive Client JSON patch: cannot set root to a primitive value'
            );
        }
    }

    const parts = pointer
        .split('/')
        .slice(1)
        .map(unescapePointerPart);

    let parent: any = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = decodePointerPart(parts[i]);
        if (!(key in parent) || parent[key] == null) {
            parent[key] = {};
        }
        parent = parent[key];
    }

    const lastKey = decodePointerPart(parts[parts.length - 1]);
    parent[lastKey] = value;
}

function unescapePointerPart(part: string): string {
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

function decodePointerPart(part: string): string | number {
    if (/^\d+$/.test(part)) {
        return Number(part);
    }
    return part;
}

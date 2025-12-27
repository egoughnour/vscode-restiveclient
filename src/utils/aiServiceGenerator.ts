import fetch, { Response } from 'node-fetch';
import { HttpFileIR, OperationIR } from './operationIR';

export type AiProvider = 'openai' | 'anthropic';

export interface AiServiceGenerationOptions {
    /** Target language for the generated body */
    language: 'typescript' | 'javascript';
    /** API provider (defaults based on baseUrl) */
    provider?: AiProvider;
    /** Base URL for the API (e.g. https://api.openai.com/v1/) */
    baseUrl?: string;
    /** API key (falls back to OPENAI_API_KEY or ANTHROPIC_API_KEY) */
    apiKey?: string;
    /** Model name */
    model?: string;
    /** Temperature for generation */
    temperature?: number;
    /** Max tokens for response */
    maxTokens?: number;
    /** Threshold for enabling thinking mode (Anthropic only) */
    thinkingThreshold?: number;
    /** Token budget for thinking mode (Anthropic only) */
    thinkingBudgetTokens?: number;
    /** Anthropic version header value */
    anthropicVersion?: string;
}

type ResolvedOptions = Required<Omit<AiServiceGenerationOptions, 'provider'>> & {
    provider: AiProvider;
};

export async function generateServiceBodies(
    fileIR: HttpFileIR,
    options: AiServiceGenerationOptions
): Promise<Record<string, string>> {
    const resolved = resolveOptions(options);
    const bodies: Record<string, string> = {};

    for (const op of fileIR.operations) {
        const { systemPrompt, userPrompt } = buildPrompts(op, resolved.language);
        const useThinking = shouldUseThinking(op, resolved);
        const generated = await generateServiceBody({
            systemPrompt,
            userPrompt,
            useThinking,
            options: resolved,
        });
        bodies[op.name] = generated;
    }

    return bodies;
}

function resolveOptions(options: AiServiceGenerationOptions): ResolvedOptions {
    const provider = resolveProvider(options);
    const baseUrl = options.baseUrl ?? (
        provider === 'anthropic' ? 'https://api.anthropic.com/v1/' : 'https://api.openai.com/v1/'
    );
    const apiKey = options.apiKey ?? resolveEnvApiKey(provider);
    if (!apiKey) {
        throw new Error(`Missing API key for provider "${provider}".`);
    }

    return {
        provider,
        baseUrl,
        apiKey,
        model: options.model ?? (provider === 'anthropic' ? 'claude-3-5-sonnet-20240620' : 'gpt-4o-mini'),
        temperature: options.temperature ?? 0.2,
        maxTokens: options.maxTokens ?? 800,
        thinkingThreshold: options.thinkingThreshold ?? 8,
        thinkingBudgetTokens: options.thinkingBudgetTokens ?? 2000,
        language: options.language,
        anthropicVersion: options.anthropicVersion ?? '2023-06-01',
    };
}

function resolveProvider(options: AiServiceGenerationOptions): AiProvider {
    if (options.provider) {
        return options.provider;
    }
    const baseUrl = options.baseUrl ?? '';
    if (baseUrl.toLowerCase().includes('anthropic.com')) {
        return 'anthropic';
    }
    return 'openai';
}

function resolveEnvApiKey(provider: AiProvider): string | undefined {
    if (provider === 'anthropic') {
        return process.env.ANTHROPIC_API_KEY;
    }
    return process.env.OPENAI_API_KEY;
}

function buildPrompts(op: OperationIR, language: 'typescript' | 'javascript'): {
    systemPrompt: string;
    userPrompt: string;
} {
    const systemPrompt = [
        'You generate the body of an async service function for an Express backend.',
        `Output only ${language} statements.`,
        'Do not include imports, function signatures, or code fences.',
        'Use the variable name "request" for input data.',
        'If outputs are defined, return an object with those fields.',
        'If outputs are empty, return an object with { status, body }.',
    ].join(' ');

    const context = buildOperationContext(op);
    const userPrompt = [
        'Operation context:',
        JSON.stringify(context, null, 2),
        'Return only the function body.',
    ].join('\n');

    return { systemPrompt, userPrompt };
}

function buildOperationContext(op: OperationIR) {
    return {
        name: op.name,
        method: op.method,
        urlTemplate: op.urlTemplate,
        inputs: op.inputs.map(input => ({
            name: input.name,
            source: input.source,
            required: input.required,
            rawExpression: input.rawExpression,
        })),
        outputs: op.outputs.map(output => ({
            name: output.name,
            source: output.source,
            selector: output.selector,
        })),
        headers: op.headers,
        body: {
            kind: op.body.kind,
            mediaType: op.body.mediaType,
            rawBodyTemplate: truncate(op.body.rawBodyTemplate ?? '', 2000),
        },
        requestShape: {
            params: op.inputs.filter(input => input.source === 'path').map(input => input.name),
            query: op.inputs.filter(input => input.source === 'query').map(input => input.name),
            headers: op.inputs.filter(input => input.source === 'header').map(input => input.name),
            body: op.body.kind !== 'none',
        },
        commentBlocks: (op.commentBlocks ?? []).map(block => ({
            name: block.name,
            content: truncate(block.content, 2000),
        })),
        dependencies: op.dependencies,
    };
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}\n...truncated...`;
}

function shouldUseThinking(op: OperationIR, options: ResolvedOptions): boolean {
    const commentLength = (op.commentBlocks ?? []).reduce((sum, block) => sum + block.content.length, 0);
    const bodyLength = op.body.rawBodyTemplate?.length ?? 0;
    const score = op.inputs.length
        + op.outputs.length
        + Math.ceil(commentLength / 200)
        + Math.ceil(bodyLength / 500);

    return score >= options.thinkingThreshold;
}

async function generateServiceBody(args: {
    systemPrompt: string;
    userPrompt: string;
    useThinking: boolean;
    options: ResolvedOptions;
}): Promise<string> {
    if (args.options.provider === 'anthropic') {
        return generateWithAnthropic(args);
    }
    return generateWithOpenAi(args);
}

async function generateWithOpenAi(args: {
    systemPrompt: string;
    userPrompt: string;
    useThinking: boolean;
    options: ResolvedOptions;
}): Promise<string> {
    const endpoint = joinUrl(args.options.baseUrl, '/chat/completions');
    const body = {
        model: args.options.model,
        messages: [
            { role: 'system', content: args.systemPrompt },
            { role: 'user', content: args.userPrompt },
        ],
        temperature: args.options.temperature,
        max_tokens: args.options.maxTokens,
    };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${args.options.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    const data = await parseResponse(response, endpoint);
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
        throw new Error('OpenAI response did not contain content.');
    }

    return normalizeGeneratedBody(content);
}

async function generateWithAnthropic(args: {
    systemPrompt: string;
    userPrompt: string;
    useThinking: boolean;
    options: ResolvedOptions;
}): Promise<string> {
    const endpoint = joinUrl(args.options.baseUrl, '/messages');
    const body: Record<string, unknown> = {
        model: args.options.model,
        max_tokens: args.options.maxTokens,
        system: args.systemPrompt,
        messages: [{ role: 'user', content: args.userPrompt }],
        temperature: args.options.temperature,
    };

    if (args.useThinking) {
        body.thinking = {
            type: 'enabled',
            budget_tokens: args.options.thinkingBudgetTokens,
        };
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': args.options.apiKey,
            'anthropic-version': args.options.anthropicVersion,
        },
        body: JSON.stringify(body),
    });

    const data = await parseResponse(response, endpoint);
    const content = extractAnthropicContent(data);
    if (!content) {
        throw new Error('Anthropic response did not contain content.');
    }

    return normalizeGeneratedBody(content);
}

function extractAnthropicContent(data: any): string {
    if (typeof data?.content === 'string') {
        return data.content;
    }
    if (Array.isArray(data?.content)) {
        return data.content.map((part: any) => part?.text ?? '').join('');
    }
    return '';
}

async function parseResponse(response: Response, endpoint: string): Promise<any> {
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${endpoint}: ${text}`);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON response from ${endpoint}: ${text}`);
    }
}

function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function normalizeGeneratedBody(text: string): string {
    let output = text.trim();
    const fencedMatch = output.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (fencedMatch) {
        output = fencedMatch[1].trim();
    }

    const openIndex = output.indexOf('{');
    const closeIndex = output.lastIndexOf('}');
    if (openIndex !== -1 && closeIndex > openIndex) {
        const prefix = output.slice(0, openIndex);
        if (/(function\s+\w+|=>|export\s+)/.test(prefix)) {
            output = output.slice(openIndex + 1, closeIndex).trim();
        }
    }

    return output;
}

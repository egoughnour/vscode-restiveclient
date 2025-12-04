import { Stream } from 'stream';
import { workspace } from 'vscode';
import { RequestHeaders } from '../models/base';
import { getContentType } from './misc';
import { MimeUtility } from './mimeUtility';
import { convertStreamToString } from './streamUtility';
import {
    applyJsonPathPokes,
    parseJsonPatchHeaderValue,
    VariableResolver
} from './jsonPathBodyPatcher';
import { applyXPathPokes } from './xmlBodyPatcher';

export interface OngoingRequest {
    url: string;
    method: string;
    headers: RequestHeaders;
    body?: string | Stream;
}

export enum TemplateOrder {
    None = 'none',
    BeforePatch = 'beforePatch',
    AfterPatch = 'afterPatch',
}

interface PatchDebugState {
    enabled: boolean;
    steps: string[];
}

export async function processBodyWithPatching(
    request: OngoingRequest,
    templateOrder: TemplateOrder,
    resolveVariables: VariableResolver
): Promise<void> {
    const debugState: PatchDebugState = {
        enabled: workspace.getConfiguration().get<boolean>('restive-client.bodyPatchDebug', false),
        steps: []
    };

    if (templateOrder === TemplateOrder.BeforePatch) {
        request.body = await applyTemplate(request.body, resolveVariables, debugState, 'template-before-patch');
    }

    await applyJsonPatchIfNeeded(request, resolveVariables, debugState);
    await applyXmlPatchIfNeeded(request, resolveVariables, debugState);

    if (templateOrder === TemplateOrder.AfterPatch) {
        request.body = await applyTemplate(request.body, resolveVariables, debugState, 'template-after-patch');
    }

    if (debugState.enabled) {
        request.headers['X-RestiveClient-Patch-Debug'] = debugState.steps.join(' | ') || 'no-patch';
    } else {
        //eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete request.headers['X-RestiveClient-Patch-Debug'];
    }
}

async function applyTemplate(
    body: string | Stream | undefined,
    resolveVariables: VariableResolver,
    debug: PatchDebugState,
    label: string
): Promise<string | undefined> {
    if (body === undefined) {
        debugStep(debug, `${label}:skipped-no-body`);
        return undefined;
    }
    let bodyText: string;
    if (typeof body === 'string') {
        bodyText = body;
    } else if (Buffer.isBuffer(body)) {
        bodyText = body.toString();
    } else if ((body as any)?.pipe) {
        bodyText = await convertStreamToString(body);
    } else {
        debugStep(debug, `${label}:skipped-unknown-body`);
        return undefined;
    }
    debugStep(debug, `${label}:start`);
    const processed = await resolveVariables(bodyText);
    debugStep(debug, `${label}:complete`);
    return processed;
}

async function applyJsonPatchIfNeeded(
    request: OngoingRequest,
    resolveVariables: VariableResolver,
    debug: PatchDebugState
): Promise<void> {
    const config = workspace.getConfiguration();
    const enabled = config.get<boolean>('restive-client.enableJsonBodyPatching', true);
    const headerName = config.get<string>('restive-client.jsonPatchHeaderName', 'X-RestiveClient-JsonPatch');
    const headerNameLower = headerName.toLowerCase();

    const { values, foundNames } = collectHeaderValues(request.headers, headerNameLower);
    if (!enabled || values.length === 0) {
        if (foundNames.length) {
            stripHeaders(request.headers, foundNames);
        }
        debugStep(debug, 'json-patch:skipped-disabled-or-missing');
        return;
    }

    const contentType = getContentType(request.headers);
    if (!isJsonPatchAllowed(contentType)) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, `json-patch:skipped-content-type:${contentType ?? 'none'}`);
        return;
    }

    let bodyText: string | undefined;
    if (typeof request.body === 'string') {
        bodyText = request.body;
    } else if (Buffer.isBuffer(request.body)) {
        bodyText = request.body.toString();
    } else if ((request.body as any)?.pipe) {
        bodyText = await convertStreamToString(request.body);
    }

    if (bodyText === undefined) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, 'json-patch:skipped-no-body');
        return;
    }

    const rules = parseJsonPatchHeaderValue(values);
    if (!rules.length) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, 'json-patch:skipped-no-rules');
        return;
    }

    debugStep(debug, `json-patch:applying:${rules.length}`);
    const patchedBody = await applyJsonPathPokes(bodyText, rules, resolveVariables);
    request.body = patchedBody;
    stripHeaders(request.headers, foundNames);
    debugStep(debug, 'json-patch:complete');
}

async function applyXmlPatchIfNeeded(
    request: OngoingRequest,
    resolveVariables: VariableResolver,
    debug: PatchDebugState
): Promise<void> {
    const config = workspace.getConfiguration();
    const enabled = config.get<boolean>('restive-client.enableXmlBodyPatching', true);
    const headerName = config.get<string>('restive-client.xmlPatchHeaderName', 'X-RestiveClient-XmlPatch');
    const headerNameLower = headerName.toLowerCase();

    const { values, foundNames } = collectHeaderValues(request.headers, headerNameLower);
    if (!enabled || values.length === 0) {
        if (foundNames.length) {
            stripHeaders(request.headers, foundNames);
        }
        debugStep(debug, 'xml-patch:skipped-disabled-or-missing');
        return;
    }

    const contentType = getContentType(request.headers);
    if (!isXmlPatchAllowed(contentType)) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, `xml-patch:skipped-content-type:${contentType ?? 'none'}`);
        return;
    }

    let bodyText: string | undefined;
    if (typeof request.body === 'string') {
        bodyText = request.body;
    } else if (Buffer.isBuffer(request.body)) {
        bodyText = request.body.toString();
    } else if ((request.body as any)?.pipe) {
        bodyText = await convertStreamToString(request.body);
    }

    if (bodyText === undefined) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, 'xml-patch:skipped-no-body');
        return;
    }

    const rules = parseJsonPatchHeaderValue(values);
    if (!rules.length) {
        stripHeaders(request.headers, foundNames);
        debugStep(debug, 'xml-patch:skipped-no-rules');
        return;
    }

    debugStep(debug, `xml-patch:applying:${rules.length}`);
    const patchedBody = await applyXPathPokes(bodyText, rules, resolveVariables);
    request.body = patchedBody;
    stripHeaders(request.headers, foundNames);
    debugStep(debug, 'xml-patch:complete');
}

function collectHeaderValues(headers: RequestHeaders, targetNameLower: string): { values: string[]; foundNames: string[] } {
    const values: string[] = [];
    const foundNames: string[] = [];
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() !== targetNameLower) {
            continue;
        }
        foundNames.push(name);
        if (typeof value === 'string') {
            values.push(value);
        } else if (Array.isArray(value)) {
            values.push(...value.map(v => String(v)));
        } else if (typeof value === 'number') {
            values.push(String(value));
        }
    }
    return { values, foundNames };
}

function stripHeaders(headers: RequestHeaders, names: string[]): void {
    for (const name of names) {
        //eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete headers[name];
    }
}

function isJsonPatchAllowed(contentType: string | undefined): boolean {
    if (!contentType) {
        return false;
    }
    const patchExceptions = [
        'application/json-patch+json',
        'application/json-patch-json'
    ];
    const essence = MimeUtility.parse(contentType).essence;
    if (patchExceptions.includes(essence)) {
        return false;
    }
    return MimeUtility.isJSON(contentType);
}

function isXmlPatchAllowed(contentType: string | undefined): boolean {
    if (!contentType) {
        return false;
    }
    const essence = MimeUtility.parse(contentType).essence;
    if (essence === 'application/xml-patch+xml') {
        return false;
    }
    return MimeUtility.isXml(contentType);
}

function debugStep(debugState: PatchDebugState, message: string): void {
    if (!debugState.enabled) {
        return;
    }
    debugState.steps.push(message);
}

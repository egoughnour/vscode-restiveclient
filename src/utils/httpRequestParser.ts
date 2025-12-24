import * as fs from 'fs-extra';
import { EOL } from 'os';
import { Stream } from 'stream';
import { TemplateOrder, OngoingRequest, processBodyWithPatching } from './bodyPatchPipeline';
import { IRestClientSettings } from '../models/configurationSettings';
import { FormParamEncodingStrategy } from '../models/formParamEncodingStrategy';
import { HttpRequest } from '../models/httpRequest';
import { RequestParser } from '../models/requestParser';
import { MimeUtility } from './mimeUtility';
import { getContentType, getHeader, removeHeader } from './misc';
import { parseRequestHeaders, resolveRequestBodyPath } from './requestParserUtil';
import { convertStreamToString } from './streamUtility';
import { VariableProcessor } from "./variableProcessor";

const CombinedStream = require('combined-stream');
const encodeurl = require('encodeurl');

enum ParseState {
    URL,
    Header,
    Body,
}

interface BodyParseResult {
    body?: string | Stream;
    templateOrder: TemplateOrder;
    /** The raw body text for display/code generation (always a string, never contains file indicators) */
    rawBodyText?: string;
}

export class HttpRequestParser implements RequestParser {
    private readonly defaultMethod = 'GET';
    private readonly queryStringLinePrefix = /^\s*[&\?]/;
    private readonly inputFileSyntax = /^<(?=[\s@jx\.])(?:(?<indicator>[^\s]+)\s+)?(?<filepath>.+?)\s*$/;
    private readonly defaultFileEncoding = 'utf8';

    public constructor(private readonly requestRawText: string, private readonly settings: IRestClientSettings) {
    }

    public async parseHttpRequest(name?: string): Promise<HttpRequest> {
        // parse follows http://www.w3.org/Protocols/rfc2616/rfc2616-sec5.html
        // split the request raw text into lines
        const lines: string[] = this.requestRawText.split(EOL);
        const requestLines: string[] = [];
        const headersLines: string[] = [];
        const bodyLines: string[] = [];
        const variableLines: string[] = [];

        let state = ParseState.URL;
        let currentLine: string | undefined;
        while ((currentLine = lines.shift()) !== undefined) {
            const nextLine = lines[0];
            switch (state) {
                case ParseState.URL:
                    requestLines.push(currentLine.trim());
                    if (nextLine === undefined
                        || this.queryStringLinePrefix.test(nextLine)) {
                        // request with request line only
                    } else if (nextLine.trim()) {
                        state = ParseState.Header;
                    } else {
                        // request with no headers but has body
                        // remove the blank line before the body
                        lines.shift();
                        state = ParseState.Body;
                    }
                    break;
                case ParseState.Header:
                    headersLines.push(currentLine.trim());
                    if (nextLine?.trim() === '') {
                        // request with no headers but has body
                        // remove the blank line before the body
                        lines.shift();
                        state = ParseState.Body;
                    }
                    break;
                case ParseState.Body:
                    bodyLines.push(currentLine);
                    break;
            }
        }

        // parse request line
        const requestLine = this.parseRequestLine(requestLines.map(l => l.trim()).join(''));

        // parse headers lines
        const headers = parseRequestHeaders(headersLines, this.settings.defaultHeaders, requestLine.url);

        // let underlying node.js library recalculate the content length
        removeHeader(headers, 'content-length');

        // check request type
        const isGraphQlRequest = getHeader(headers, 'X-Request-Type') === 'GraphQL'.toLowerCase();
        if (isGraphQlRequest) {
            removeHeader(headers, 'X-Request-Type');

            // a request doesn't necessarily need variables to be considered a GraphQL request
            const firstEmptyLine = bodyLines.findIndex(value => value.trim() === '');
            if (firstEmptyLine !== -1) {
                variableLines.push(...bodyLines.splice(firstEmptyLine + 1));
                bodyLines.pop();    // remove the empty line between body and variables
            }
        }

        // parse body lines
        const contentTypeHeader = getContentType(headers);
        const bodyResult = await this.parseBody(bodyLines, contentTypeHeader);
        let templateOrder = bodyResult.templateOrder;
        let body = bodyResult.body;
        let rawBodyText = bodyResult.rawBodyText;
        if (isGraphQlRequest) {
            const graphQlResult = await this.createGraphQlBody(variableLines, contentTypeHeader, bodyResult);
            body = graphQlResult.body;
            templateOrder = graphQlResult.templateOrder;
            rawBodyText = graphQlResult.body; // For GraphQL, the raw body is the constructed JSON payload
        } else if (this.settings.formParamEncodingStrategy !== FormParamEncodingStrategy.Never && typeof body === 'string' && MimeUtility.isFormUrlEncoded(contentTypeHeader)) {
            if (this.settings.formParamEncodingStrategy === FormParamEncodingStrategy.Always) {
                const stringPairs = body.split('&');
                const encodedStringPairs: string[] = [];
                for (const stringPair of stringPairs) {
                    const [name, ...values] = stringPair.split('=');
                    const value = values.join('=');
                    encodedStringPairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
                }
                const encodedBody = encodedStringPairs.join('&');
                body = encodedBody;
                rawBodyText = encodedBody; // Use encoded body as raw body text
            } else {
                const encodedBody = encodeurl(body) as string;
                body = encodedBody;
                rawBodyText = encodedBody; // Use encoded body as raw body text
            }
        }

        // if Host header provided and url is relative path, change to absolute url
        const host = getHeader(headers, 'Host');
        if (host && requestLine.url[0] === '/') {
            const [, port] = host.toString().split(':');
            const scheme = port === '443' || port === '8443' ? 'https' : 'http';
            requestLine.url = `${scheme}://${host}${requestLine.url}`;
        }
        const outgoingRequest: OngoingRequest = {
            url: requestLine.url,
            method: requestLine.method,
            headers,
            body,
        };
        await processBodyWithPatching(
            outgoingRequest,
            templateOrder,
            async (text: string) => VariableProcessor.processRawRequest(text)
        );
        body = outgoingRequest.body;
        // After patching, update rawBodyText if the body was modified to a string
        if (typeof body === 'string') {
            rawBodyText = body;
        }

        return new HttpRequest(requestLine.method, requestLine.url, headers, body, rawBodyText, name);
    }

    private async createGraphQlBody(
        variableLines: string[],
        contentTypeHeader: string | undefined,
        bodyResult: BodyParseResult
    ): Promise<{ body: string; templateOrder: TemplateOrder }> {
        const variablesResult = await this.parseBody(variableLines, contentTypeHeader);
        const templateOrder = this.combineTemplateOrders(bodyResult.templateOrder, variablesResult.templateOrder);

        const variablesText = await this.materializeBody(variablesResult.body);
        const bodyText = await this.materializeBody(bodyResult.body);

        const matched = bodyText?.match(/^\s*query\s+([^@\{\(\s]+)/i);
        const operationName = matched?.[1];

        const graphQlPayload = {
            query: bodyText,
            operationName,
            variables: variablesText ? JSON.parse(variablesText) : {}
        };
        return {
            body: JSON.stringify(graphQlPayload),
            templateOrder
        };
    }

    private parseRequestLine(line: string): { method: string, url: string } {
        // Request-Line = Method SP Request-URI SP HTTP-Version CRLF
        let method: string;
        let url: string;

        let match: RegExpExecArray | null;
        if (match = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|LOCK|UNLOCK|PROPFIND|PROPPATCH|COPY|MOVE|MKCOL|MKCALENDAR|ACL|SEARCH)\s+/i.exec(line)) {
            method = match[1];
            url = line.substr(match[0].length);
        } else {
            // Only provides request url
            method = this.defaultMethod;
            url = line;
        }

        url = url.trim();

        if (match = /\s+HTTP\/.*$/i.exec(url)) {
            url = url.substr(0, match.index);
        }

        return { method, url };
    }

    private async parseBody(lines: string[], contentTypeHeader: string | undefined): Promise<BodyParseResult> {
        if (lines.length === 0) {
            return { body: undefined, templateOrder: TemplateOrder.None, rawBodyText: undefined };
        }

        // Check if needed to upload file
        if (lines.every(line => !this.inputFileSyntax.test(line))) {
            if (MimeUtility.isFormUrlEncoded(contentTypeHeader)) {
                const body = lines.reduce((p, c, i) => {
                    p += `${(i === 0 || c.startsWith('&') ? '' : EOL)}${c}`;
                    return p;
                }, '');
                return { body, templateOrder: TemplateOrder.None, rawBodyText: body };
            } else {
                const lineEnding = this.getLineEnding(contentTypeHeader);
                let body = lines.join(lineEnding);
                if (MimeUtility.isNewlineDelimitedJSON(contentTypeHeader)) {
                    body += lineEnding;
                }
                return { body, templateOrder: TemplateOrder.None, rawBodyText: body };
            }
        } else {
            // When file indicators are present, we always read file contents as strings
            // to ensure rawBodyText is available for code snippet generation
            const stringParts: string[] = [];
            const streamParts: Array<string | Stream> = [];
            let templateOrder: TemplateOrder = TemplateOrder.None;
            let templateRequested = false;
            let forbidTemplate = false;
            let materialize = false;
            let hasStreamPart = false;

            for (const [index, line] of lines.entries()) {
                if (this.inputFileSyntax.test(line)) {
                    const groups = this.inputFileSyntax.exec(line);
                    const groupsValues = groups?.groups;
                    if (groups?.groups && groupsValues) {
                        const inputFilePath = groupsValues.filepath.trim();
                        const indicator = groupsValues.indicator;
                        const parsedIndicator = this.parseIndicator(indicator);
                        if (parsedIndicator.forbidTemplate) {
                            if (templateRequested) {
                                throw new Error('Restive Client body parsing: conflicting template instructions for "<." and "@" markers.');
                            }
                            forbidTemplate = true;
                        }
                        if (parsedIndicator.templateOrder !== TemplateOrder.None) {
                            if (templateRequested && templateOrder !== parsedIndicator.templateOrder) {
                                throw new Error('Restive Client body parsing: conflicting template substitution order markers.');
                            }
                            if (forbidTemplate) {
                                throw new Error('Restive Client body parsing: template processing disabled for this body but "@" marker found.');
                            }
                            templateRequested = true;
                            templateOrder = parsedIndicator.templateOrder;
                        }
                        if (parsedIndicator.encoding) {
                            materialize = true;
                        }
                        const fileAbsolutePath = await resolveRequestBodyPath(inputFilePath);
                        if (fileAbsolutePath) {
                            // Always read file content as string for rawBodyText
                            const encoding = parsedIndicator.encoding || this.defaultFileEncoding;
                            const buffer = await fs.readFile(fileAbsolutePath);
                            const fileContent = buffer.toString(encoding as BufferEncoding);
                            stringParts.push(fileContent);
                            // For the actual body, use stream if not materializing
                            if (parsedIndicator.encoding || materialize || templateRequested) {
                                streamParts.push(fileContent);
                            } else {
                                streamParts.push(fs.createReadStream(fileAbsolutePath));
                                hasStreamPart = true;
                            }
                        } else {
                            stringParts.push(line);
                            streamParts.push(line);
                        }
                    }
                } else {
                    stringParts.push(line);
                    streamParts.push(line);
                }

                if ((index !== lines.length - 1) || MimeUtility.isMultiPartFormData(contentTypeHeader)) {
                    const ending = this.getLineEnding(contentTypeHeader);
                    stringParts.push(ending);
                    streamParts.push(ending);
                }
            }

            const finalTemplateOrder = templateRequested ? templateOrder : TemplateOrder.None;
            const rawBodyText = stringParts.join('');
            
            if (materialize || templateRequested || !hasStreamPart) {
                // Return string body when we need to materialize or when there are no stream parts
                return { body: rawBodyText, templateOrder: finalTemplateOrder, rawBodyText };
            }
            
            // Use stream for body but keep rawBodyText available
            const combinedStream = CombinedStream.create({ maxDataSize: 10 * 1024 * 1024 });
            for (const part of streamParts) {
                combinedStream.append(part);
            }
            return { body: combinedStream, templateOrder: finalTemplateOrder, rawBodyText };
        }
    }

    private getLineEnding(contentTypeHeader: string | undefined) {
        return MimeUtility.isMultiPartFormData(contentTypeHeader) ? '\r\n' : EOL;
    }

    private parseIndicator(indicator: string | undefined): { templateOrder: TemplateOrder; encoding?: string; forbidTemplate: boolean } {
        if (!indicator) {
            return { templateOrder: TemplateOrder.None, forbidTemplate: false };
        }
        if (indicator === '.') {
            return { templateOrder: TemplateOrder.None, forbidTemplate: true };
        }
        const atIndex = indicator.indexOf('@');
        if (atIndex === -1) {
            return { templateOrder: TemplateOrder.None, forbidTemplate: false };
        }
        const before = indicator.slice(0, atIndex);
        const after = indicator.slice(atIndex + 1);

        if (before === 'j' || before === 'x') {
            return {
                templateOrder: TemplateOrder.AfterPatch,
                encoding: after || this.defaultFileEncoding,
                forbidTemplate: false
            };
        }

        let encoding: string | undefined = after || this.defaultFileEncoding;
        let templateOrder = TemplateOrder.BeforePatch;
        if (after.startsWith('j') || after.startsWith('x')) {
            templateOrder = TemplateOrder.BeforePatch;
            encoding = after.slice(1) || this.defaultFileEncoding;
        }
        if (indicator === '@') {
            encoding = this.defaultFileEncoding;
        }
        return {
            templateOrder,
            encoding,
            forbidTemplate: false
        };
    }

    private async materializeBody(body: string | Stream | undefined): Promise<string | undefined> {
        if (body === undefined) {
            return undefined;
        }
        if (typeof body === 'string') {
            return body;
        }
        if (Buffer.isBuffer(body)) {
            return body.toString();
        }
        return convertStreamToString(body);
    }

    private combineTemplateOrders(first: TemplateOrder, second: TemplateOrder): TemplateOrder {
        if (first === TemplateOrder.None) {
            return second;
        }
        if (second === TemplateOrder.None) {
            return first;
        }
        if (first !== second) {
            throw new Error('Restive Client body parsing: conflicting template substitution order markers in GraphQL body and variables.');
        }
        return first;
    }
}

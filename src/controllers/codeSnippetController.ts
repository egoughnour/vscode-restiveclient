import { EOL } from 'os';
import * as url from 'url';
import { Clipboard, env, ExtensionContext, QuickInputButtons, QuickPickItem, window } from 'vscode';
import Logger from '../logger';
import { IRestClientSettings, RequestSettings, RestClientSettings } from '../models/configurationSettings';
import { codeSnippetParameterizer, CSharpType, MethodWrapperConfig, ParameterSpec } from '../utils/codeSnippetParameterizer';
import { HARCookie, HARHeader, HARHttpRequest, HARPostData } from '../models/harHttpRequest';
import { HttpRequest } from '../models/httpRequest';
import { RequestParserFactory } from '../models/requestParserFactory';
import { trace } from "../utils/decorator";
import { base64 } from '../utils/misc';
import { Selector } from '../utils/selector';
import { Telemetry } from '../utils/telemetry';
import { getCurrentTextDocument } from '../utils/workspaceUtility';
import { CodeSnippetWebview } from '../views/codeSnippetWebview';

const encodeUrl = require('encodeurl');
const HTTPSnippet = require('httpsnippet');

type CodeSnippetClient = {
    key: string;
    title: string;
    link: string;
    description: string;
};

type CodeSnippetTarget = {
    key: string;
    title: string;
    clients: CodeSnippetClient[];
};

interface ParameterizationOption extends QuickPickItem {
    parameterize: boolean;
}

export class CodeSnippetController {
    private readonly _availableTargets: CodeSnippetTarget[] = HTTPSnippet.availableTargets();
    private readonly clipboard: Clipboard;
    private _webview: CodeSnippetWebview;

    constructor(context: ExtensionContext) {
        this._webview = new CodeSnippetWebview(context);
        this.clipboard = env.clipboard;
    }

    public async run() {
        const editor = window.activeTextEditor;
        const document = getCurrentTextDocument();
        if (!editor || !document) {
            return;
        }

        const selectedRequest = await Selector.getRequest(editor);
        if (!selectedRequest) {
            return;
        }

        const { text, metadatas } = selectedRequest;
        const requestSettings = new RequestSettings(metadatas);
        const settings: IRestClientSettings = new RestClientSettings(requestSettings);

        // parse http request
        const httpRequest = await RequestParserFactory.createRequestParser(text, settings).parseHttpRequest();

        const harHttpRequest = this.convertToHARHttpRequest(httpRequest);
        const snippet = new HTTPSnippet(harHttpRequest);

        let target: Pick<CodeSnippetTarget, 'key' | 'title'> | undefined = undefined;
        let client: Pick<CodeSnippetClient, 'key' | 'title'> | undefined = undefined;

        const quickPick = window.createQuickPick();
        const targetQuickPickItems = this._availableTargets.map(target => ({ label: target.title, ...target }));
        quickPick.title = 'Generate Code Snippet';
        quickPick.step = 1;
        quickPick.totalSteps = 2;
        quickPick.items = targetQuickPickItems;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.onDidTriggerButton(() => {
            if (quickPick.step === 2) {
                quickPick.step = 1;
                quickPick.totalSteps = 2;
                quickPick.buttons = [];
                quickPick.items = targetQuickPickItems;
                target = undefined;
            } else if (quickPick.step === 3) {
                quickPick.step = 2;
                quickPick.totalSteps = codeSnippetParameterizer.hasTransformer(target!.key, client!.key) ? 3 : 2;
                quickPick.buttons = [QuickInputButtons.Back];
                quickPick.items = (target as CodeSnippetTarget).clients.map(
                    c => ({ label: c.title, detail: c.link, ...c })
                );
                client = undefined;
            }
        });
        quickPick.onDidAccept(() => {
            const selectedItem = quickPick.selectedItems[0];
            if (quickPick.step === 1) {
                quickPick.value = '';
                quickPick.step++;
                target = selectedItem as any as CodeSnippetTarget;
                // Check if parameterization is available for this target
                const hasParameterization = (target as CodeSnippetTarget).clients.some(
                    c => codeSnippetParameterizer.hasTransformer(target!.key, c.key)
                );
                quickPick.totalSteps = hasParameterization ? 3 : 2;
                quickPick.buttons = [QuickInputButtons.Back];
                quickPick.items = (target as CodeSnippetTarget).clients.map(
                    c => {
                        const parameterizationAvailable = codeSnippetParameterizer.hasTransformer(target!.key, c.key);
                        return {
                            label: c.title,
                            detail: c.link,
                            description: parameterizationAvailable ? '✨ Parameterization available' : c.description,
                            key: c.key
                        };
                    }
                );
            } else if (quickPick.step === 2) {
                const { key: ck, title: ct } = selectedItem as any as CodeSnippetClient;
                client = { key: ck, title: ct };
                
                // Check if parameterization is available
                if (codeSnippetParameterizer.hasTransformer(target!.key, ck)) {
                    quickPick.value = '';
                    quickPick.step++;
                    quickPick.items = this.getParameterizationOptions();
                } else {
                    // No parameterization, generate directly
                    this.generateAndShowSnippet(snippet, target!, client!, quickPick, false);
                }
            } else if (quickPick.step === 3) {
                const useParameterization = (selectedItem as ParameterizationOption).parameterize;
                this.generateAndShowSnippet(snippet, target!, client!, quickPick, useParameterization);
            }
        });
        quickPick.show();
    }

    private getParameterizationOptions(): ParameterizationOption[] {
        return [
            {
                label: '$(symbol-method) Wrap in method with parameters',
                description: 'Extract URL and headers as method parameters',
                parameterize: true
            },
            {
                label: '$(code) Raw code snippet',
                description: 'Generate plain code without method wrapper',
                parameterize: false
            }
        ];
    }

    private generateAndShowSnippet(
        snippet: any,
        target: Pick<CodeSnippetTarget, 'key' | 'title'>,
        client: Pick<CodeSnippetClient, 'key' | 'title'>,
        quickPick: any,
        useParameterization: boolean
    ) {
        const { key: tk, title: tt } = target;
        const { key: ck, title: ct } = client;
        
        Telemetry.sendEvent('Generate Code Snippet', { 
            'target': tk, 
            'client': ck,
            'parameterized': useParameterization.toString()
        });
        
        let result = snippet.convert(tk, ck);
        
        if (useParameterization && codeSnippetParameterizer.hasTransformer(tk, ck)) {
            const parameters: ParameterSpec[] = [
                { path: '$.url', parameterName: 'baseUrl', type: CSharpType.String }
            ];
            
            // Extract Authorization header if present
            const harRequest = snippet.requests[0];
            if (harRequest?.headers?.some((h: any) => h.name.toLowerCase() === 'authorization')) {
                parameters.push({
                    path: '$.headers.Authorization',
                    parameterName: 'authToken',
                    type: CSharpType.String,
                    defaultValue: this.getDefaultNullValue(tk)
                });
            }
            
            const methodConfig = this.getMethodConfigForTarget(tk, ck);
            
            const parameterized = codeSnippetParameterizer.parameterize(
                result,
                tk,
                ck,
                parameters,
                methodConfig
            );
            result = parameterized.code;
        }
        
        quickPick.hide();
        try {
            this._webview.render(result, `${tt}-${ct}`, tk);
        } catch (reason) {
            Logger.error('Unable to preview generated code snippet:', reason);
            window.showErrorMessage(reason);
        }
    }

    private getDefaultNullValue(targetKey: string): string {
        switch (targetKey) {
            case 'python':
                return 'None';
            case 'javascript':
            case 'node':
                return 'null';
            case 'go':
                return '""';
            default:
                return 'null';
        }
    }

    private getMethodConfigForTarget(targetKey: string, clientKey: string): MethodWrapperConfig {
        switch (targetKey) {
            case 'csharp':
                return {
                    methodName: 'SendRequestAsync',
                    isAsync: true,
                    returnType: clientKey === 'httpclient' ? 'Task<HttpResponseMessage>' : 'Task<IRestResponse>',
                    accessModifier: 'public',
                    isStatic: false,
                    summary: 'Sends the HTTP request',
                    usings: ['System.Threading.Tasks']
                };
            case 'python':
                return {
                    methodName: 'send_request',
                    isAsync: false,
                    returnType: 'requests.Response',
                    accessModifier: '',
                    isStatic: false,
                    summary: 'Sends the HTTP request',
                    usings: ['requests']
                };
            case 'javascript':
            case 'node':
                return {
                    methodName: 'sendRequest',
                    isAsync: true,
                    returnType: 'Promise<Response>',
                    accessModifier: '',
                    isStatic: false,
                    summary: 'Sends the HTTP request'
                };
            case 'java':
                return {
                    methodName: 'sendRequest',
                    isAsync: false,
                    returnType: clientKey === 'nethttp' ? 'HttpResponse<String>' : 'Response',
                    accessModifier: 'public',
                    isStatic: true,
                    summary: 'Sends the HTTP request'
                };
            case 'go':
                return {
                    methodName: 'SendRequest',
                    isAsync: false,
                    returnType: '(*http.Response, error)',
                    accessModifier: '',
                    isStatic: false,
                    summary: 'sends the HTTP request',
                    usings: ['net/http']
                };
            default:
                return {
                    methodName: 'sendRequest',
                    isAsync: false,
                    returnType: 'any',
                    accessModifier: 'public',
                    isStatic: false,
                    summary: 'Sends the HTTP request'
                };
        }
    }

    @trace('Copy Request As cURL')
    public async copyAsCurl() {
        const editor = window.activeTextEditor;
        const document = getCurrentTextDocument();
        if (!editor || !document) {
            return;
        }

        const selectedRequest = await Selector.getRequest(editor);
        if (!selectedRequest) {
            return;
        }

        const { text, metadatas } = selectedRequest;
        const requestSettings = new RequestSettings(metadatas);
        const settings: IRestClientSettings = new RestClientSettings(requestSettings);

        // parse http request
        const httpRequest = await RequestParserFactory.createRequestParser(text, settings).parseHttpRequest();

        const harHttpRequest = this.convertToHARHttpRequest(httpRequest);
        const addPrefix = !(url.parse(harHttpRequest.url).protocol);
        const originalUrl = harHttpRequest.url;
        if (addPrefix) {
            // Add protocol for url that doesn't specify protocol to pass the HTTPSnippet validation #328
            harHttpRequest.url = `http://${originalUrl}`;
        }
        const snippet = new HTTPSnippet(harHttpRequest);
        if (addPrefix) {
            snippet.requests[0].fullUrl = originalUrl;
        }
        const result = snippet.convert('shell', 'curl', process.platform === 'win32' ? { indent: false } : {});
        await this.clipboard.writeText(result);
    }

    private convertToHARHttpRequest(request: HttpRequest): HARHttpRequest {
        // convert headers
        const headers: HARHeader[] = [];
        for (const key in request.headers) {
            const headerValue = request.headers[key];
            if (!headerValue) {
                continue;
            }
            const headerValues = Array.isArray(headerValue) ? headerValue : [headerValue.toString()];
            for (let value of headerValues) {
                if (key.toLowerCase() === 'authorization') {
                    value = CodeSnippetController.normalizeAuthHeader(value);
                }
                headers.push(new HARHeader(key, value));
            }
        }

        // convert cookie headers
        const cookies: HARCookie[] = [];
        const cookieHeader = headers.find(header => header.name.toLowerCase() === 'cookie');
        if (cookieHeader) {
            cookieHeader.value.split(';').forEach(pair => {
                const [headerName, headerValue = ''] = pair.split('=', 2);
                cookies.push(new HARCookie(headerName.trim(), headerValue.trim()));
            });
        }

        // convert body
        let body: HARPostData | undefined;
        if (request.body) {
            const contentTypeHeader = headers.find(header => header.name.toLowerCase() === 'content-type');
            const mimeType: string = contentTypeHeader?.value ?? 'application/json';
            if (typeof request.body === 'string') {
                const normalizedBody = request.body.split(EOL).reduce((prev, cur) => prev.concat(cur.trim()), '');
                body = new HARPostData(mimeType, normalizedBody);
            } else {
                body = new HARPostData(mimeType, request.rawBody!);
            }
        }

        return new HARHttpRequest(request.method, encodeUrl(request.url), headers, cookies, body);
    }

    public dispose() {
        this._webview.dispose();
    }

    private static normalizeAuthHeader(authHeader: string) {
        if (authHeader) {
            const start = authHeader.indexOf(' ');
            const scheme = authHeader.substr(0, start);
            if (scheme.toLowerCase() === 'basic') {
                const params = authHeader.substr(start).trim().split(' ');
                if (params.length === 2) {
                    return `Basic ${base64(`${params[0]}:${params[1]}`)}`;
                } else if (params.length === 1 && params[0].includes(':')) {
                    const [user, password] = params[0].split(':');
                    return `Basic ${base64(`${user}:${password}`)}`;
                }
            }
        }

        return authHeader;
    }
}
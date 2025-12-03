const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
const compilerOptions = Object.assign({}, tsconfig.compilerOptions, {
    module: ts.ModuleKind.CommonJS,
});

require.extensions['.ts'] = function transpileHook(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions });
    return module._compile(outputText, filename);
};

class MockEventEmitter {
    constructor() {
        this.listeners = [];
    }

    event = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => undefined };
    };

    fire = (...args) => {
        for (const listener of this.listeners) {
            listener(...args);
        }
    };
}

const configurationStore = new Map();
const disposable = () => ({ dispose: () => undefined });
const vscodeStub = {
    EventEmitter: MockEventEmitter,
    workspace: {
        getConfiguration: () => ({
            get: (key, defaultValue) => configurationStore.has(key) ? configurationStore.get(key) : defaultValue,
        }),
        getWorkspaceFolder: () => undefined,
        onDidChangeConfiguration: disposable,
        __setConfigurationValue: (key, value) => configurationStore.set(key, value),
        __resetConfiguration: () => configurationStore.clear(),
    },
    window: {
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: disposable,
        createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined }),
        showErrorMessage: () => undefined,
        showWarningMessage: () => undefined,
        showInformationMessage: () => undefined,
    },
    languages: {
        onDidChangeDiagnostics: disposable,
        setLanguageConfiguration: () => undefined,
    },
    env: {
        clipboard: {
            readText: async () => '',
            writeText: async () => undefined,
        },
    },
    extensions: {
        getExtension: () => undefined,
    },
    ViewColumn: {
        Active: 1,
        Beside: 2,
    },
    Uri: {
        parse: value => ({ fsPath: path.resolve(value) }),
    },
};

const appInsightsChain = {
    setAutoCollectConsole: () => appInsightsChain,
    setAutoCollectDependencies: () => appInsightsChain,
    setAutoCollectExceptions: () => appInsightsChain,
    setAutoCollectPerformance: () => appInsightsChain,
    setAutoCollectRequests: () => appInsightsChain,
    setAutoDependencyCorrelation: () => appInsightsChain,
    setUseDiskRetryCaching: () => appInsightsChain,
    start: () => appInsightsChain,
};

const appInsightsStub = {
    defaultClient: {
        context: {
            keys: { applicationVersion: 'applicationVersion' },
            tags: {},
        },
        trackEvent: () => undefined,
    },
    setup: () => appInsightsChain,
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') {
        return vscodeStub;
    }
    if (request === 'applicationinsights') {
        return appInsightsStub;
    }
    return originalLoad.apply(this, [request, parent, isMain]);
};

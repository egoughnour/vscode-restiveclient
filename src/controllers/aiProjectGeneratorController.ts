import * as path from 'path';
import * as fs from 'fs-extra';
import { commands, ProgressLocation, QuickPickItem, Uri, window, workspace } from 'vscode';
import { AiProvider, AiServiceGenerationOptions } from '../utils/aiServiceGenerator';
import { parseHttpFileToIR } from '../utils/irGenerator';
import { generateAndWriteProjectWithAi, ProjectGeneratorOptions } from '../utils/expressProjectGenerator';
import { getCurrentHttpFileName, getCurrentTextDocument } from '../utils/workspaceUtility';

type LanguageOption = 'typescript' | 'javascript';

interface PickOption<T> extends QuickPickItem {
    value: T;
}

interface ConfigValue<T> {
    value: T;
    isExplicit: boolean;
}

export class AiProjectGeneratorController {
    public async run() {
        const document = getCurrentTextDocument();
        if (!document) {
            window.showErrorMessage('Open a .http file before generating a project.');
            return;
        }

        if (document.languageId !== 'http') {
            window.showErrorMessage('AI project generation is only supported for .http files.');
            return;
        }

        const config = workspace.getConfiguration('restive-client', document.uri);
        const baseUrlSetting = config.get<string>('ai.baseUrl', 'https://api.anthropic.com/v1/').trim();
        const baseUrl = baseUrlSetting || 'https://api.anthropic.com/v1/';
        const providerConfig = this.getConfigValue(config, 'ai.provider', '');
        const provider = providerConfig.isExplicit && providerConfig.value
            ? (providerConfig.value as AiProvider)
            : undefined;
        const resolvedProvider = provider ?? this.resolveProviderFromBaseUrl(baseUrl);

        const apiKey = await this.resolveApiKey(config, resolvedProvider);
        if (!apiKey) {
            return;
        }

        const appName = await this.pickAppName(document.uri);
        if (!appName) {
            return;
        }

        const defaultLanguage = config.get<LanguageOption>('ai.defaultLanguage', 'typescript');
        const language = await this.pickLanguage(defaultLanguage);
        if (!language) {
            return;
        }

        const outputDirectory = await this.resolveOutputDirectory(config, document.uri);
        if (!outputDirectory) {
            return;
        }

        const outputRoot = this.resolveOutputPath(outputDirectory, document.uri);
        const projectRoot = path.join(outputRoot, appName);
        if (await fs.pathExists(projectRoot)) {
            const choice = await window.showWarningMessage(
                `Folder already exists: ${projectRoot}`,
                { modal: true },
                'Overwrite',
                'Cancel'
            );
            if (choice !== 'Overwrite') {
                return;
            }
        }

        const generatorOptions = this.buildProjectOptions(config, appName, language);
        const aiOptions = this.buildAiOptions(config, baseUrl, provider, apiKey, language);

        try {
            const basePath = path.dirname(document.uri.fsPath);
            const fileIR = await parseHttpFileToIR(document.getText(), { basePath });
            if (fileIR.operations.length === 0) {
                window.showErrorMessage('No named requests found. Add @name to requests before generating.');
                return;
            }

            await window.withProgress(
                {
                    location: ProgressLocation.Notification,
                    title: 'Generating Express project with AI',
                    cancellable: false,
                },
                async () => {
                    await generateAndWriteProjectWithAi(fileIR, generatorOptions, aiOptions, outputRoot);
                }
            );

            window.showInformationMessage(`Generated project at ${projectRoot}`);
        } catch (error) {
            window.showErrorMessage(`Failed to generate project: ${String(error)}`);
        }
    }

    private buildProjectOptions(
        config: ReturnType<typeof workspace.getConfiguration>,
        appName: string,
        language: LanguageOption
    ): ProjectGeneratorOptions {
        const description = config.get<string>('ai.projectDescription', '').trim();
        return {
            projectName: appName,
            description: description || undefined,
            apiBasePath: config.get<string>('ai.apiBasePath', '/api/v1'),
            port: config.get<number>('ai.port', 3000),
            typescript: language === 'typescript',
            includeDocker: config.get<boolean>('ai.includeDocker', true),
            includeTests: config.get<boolean>('ai.includeTests', true),
            includeApiExplorer: config.get<boolean>('ai.includeApiExplorer', true),
            nodeVersion: config.get<string>('ai.nodeVersion', '>=18.0.0'),
        };
    }

    private buildAiOptions(
        config: ReturnType<typeof workspace.getConfiguration>,
        baseUrl: string,
        provider: AiProvider | undefined,
        apiKey: string,
        language: LanguageOption
    ): AiServiceGenerationOptions {
        const model = config.get<string>('ai.model', '').trim();
        return {
            provider,
            baseUrl,
            apiKey,
            model: model || undefined,
            temperature: config.get<number>('ai.temperature', 0.2),
            maxTokens: config.get<number>('ai.maxTokens', 800),
            thinkingThreshold: config.get<number>('ai.thinkingThreshold', 8),
            thinkingBudgetTokens: config.get<number>('ai.thinkingBudgetTokens', 2000),
            anthropicVersion: config.get<string>('ai.anthropicVersion', '2023-06-01'),
            language,
        };
    }

    private resolveProviderFromBaseUrl(baseUrl: string): AiProvider {
        return baseUrl.toLowerCase().includes('anthropic.com') ? 'anthropic' : 'openai';
    }

    private async resolveApiKey(
        config: ReturnType<typeof workspace.getConfiguration>,
        provider: AiProvider
    ): Promise<string | undefined> {
        const configuredKey = config.get<string>('ai.apiKey', '').trim();
        if (configuredKey) {
            return configuredKey;
        }

        const envKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
        if (envKey) {
            return envKey;
        }

        const choice = await this.showQuickPick(
            [
                {
                    label: 'Open Settings',
                    description: 'Configure restive-client.ai.apiKey',
                    value: 'settings',
                },
                {
                    label: 'Enter API key for this run',
                    description: 'Key will not be saved',
                    value: 'input',
                },
            ],
            'API key is required to generate service bodies'
        );
        if (!choice) {
            return undefined;
        }

        if (choice.value === 'settings') {
            await commands.executeCommand('workbench.action.openSettings', 'restive-client.ai');
            return undefined;
        }

        const input = await window.showInputBox({
            prompt: 'Enter API key',
            password: true,
            ignoreFocusOut: true,
        });
        return input?.trim() || undefined;
    }

    private async pickAppName(sourceUri: Uri): Promise<string | undefined> {
        const suggestions = new Set<string>();
        const workspaceFolder = workspace.getWorkspaceFolder(sourceUri);
        if (workspaceFolder) {
            suggestions.add(path.basename(workspaceFolder.uri.fsPath));
        }

        const fileName = getCurrentHttpFileName();
        if (fileName) {
            suggestions.add(fileName);
        }

        const items: Array<PickOption<string>> = Array.from(suggestions).map(name => ({
            label: name,
            value: name,
        }));

        items.push({
            label: 'Enter custom name...',
            value: '__custom__',
        });

        const selected = await this.showQuickPick(items, 'Select the application name');
        if (!selected) {
            return undefined;
        }

        if (selected.value === '__custom__') {
            const input = await window.showInputBox({
                prompt: 'Enter the application name',
                validateInput: value => value.trim().length > 0 ? undefined : 'App name is required',
            });
            return input?.trim() || undefined;
        }

        return selected.value;
    }

    private async pickLanguage(defaultLanguage: LanguageOption): Promise<LanguageOption | undefined> {
        const items: Array<PickOption<LanguageOption>> = [
            { label: 'TypeScript', value: 'typescript' },
            { label: 'JavaScript', value: 'javascript' },
        ];

        const defaultItem = items.find(item => item.value === defaultLanguage);
        const selected = await this.showQuickPick(items, 'Select project language', defaultItem);
        return selected?.value;
    }

    private async resolveOutputDirectory(
        config: ReturnType<typeof workspace.getConfiguration>,
        sourceUri: Uri
    ): Promise<string | undefined> {
        const configured = config.get<string>('ai.outputDirectory', '').trim();
        if (configured) {
            return configured;
        }

        const workspaceFolder = workspace.getWorkspaceFolder(sourceUri);
        const defaultUri = workspaceFolder?.uri ?? Uri.file(path.dirname(sourceUri.fsPath));
        const selection = await window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            openLabel: 'Select output directory',
        });

        return selection?.[0]?.fsPath;
    }

    private resolveOutputPath(outputDirectory: string, sourceUri: Uri): string {
        if (path.isAbsolute(outputDirectory)) {
            return outputDirectory;
        }

        const workspaceFolder = workspace.getWorkspaceFolder(sourceUri);
        if (workspaceFolder) {
            return path.join(workspaceFolder.uri.fsPath, outputDirectory);
        }

        return path.join(path.dirname(sourceUri.fsPath), outputDirectory);
    }

    private async showQuickPick<T extends QuickPickItem>(
        items: T[],
        placeholder: string,
        defaultItem?: T
    ): Promise<T | undefined> {
        const quickPick = window.createQuickPick<T>();
        quickPick.items = items;
        quickPick.placeholder = placeholder;
        if (defaultItem) {
            quickPick.activeItems = [defaultItem];
        }

        return new Promise(resolve => {
            quickPick.onDidAccept(() => {
                resolve(quickPick.selectedItems[0]);
                quickPick.hide();
            });
            quickPick.onDidHide(() => {
                resolve(undefined);
                quickPick.dispose();
            });
            quickPick.show();
        });
    }

    private getConfigValue<T>(
        config: ReturnType<typeof workspace.getConfiguration>,
        key: string,
        fallback: T
    ): ConfigValue<T> {
        const inspection = config.inspect<T>(key);
        const isExplicit = Boolean(
            inspection?.globalValue !== undefined ||
            inspection?.workspaceValue !== undefined ||
            inspection?.workspaceFolderValue !== undefined
        );
        const value = config.get<T>(key, fallback);
        return { value, isExplicit };
    }
}

import * as path from 'path';
import * as fs from 'fs-extra';
import { ProgressLocation, QuickPickItem, Uri, window, workspace } from 'vscode';
import { parseHttpFileToIR } from '../utils/irGenerator';
import { generateAndWriteProject, ProjectGeneratorOptions } from '../utils/expressProjectGenerator';
import { getCurrentHttpFileName, getCurrentTextDocument } from '../utils/workspaceUtility';

type LanguageOption = 'typescript' | 'javascript';

interface PickOption<T> extends QuickPickItem {
    value: T;
}

export class ExpressProjectGeneratorController {
    public async run() {
        const document = getCurrentTextDocument();
        if (!document) {
            window.showErrorMessage('Open a .http file before generating a project.');
            return;
        }

        if (document.languageId !== 'http') {
            window.showErrorMessage('Project generation is only supported for .http files.');
            return;
        }

        const config = workspace.getConfiguration('restive-client', document.uri);
        const appName = await this.pickAppName(document.uri);
        if (!appName) {
            return;
        }

        const defaultLanguage = config.get<LanguageOption>('projectGenerator.defaultLanguage', 'typescript');
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
                    title: 'Generating Express project',
                    cancellable: false,
                },
                async () => {
                    await generateAndWriteProject(fileIR, generatorOptions, outputRoot);
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
        const description = config.get<string>('projectGenerator.projectDescription', '').trim();
        return {
            projectName: appName,
            description: description || undefined,
            apiBasePath: config.get<string>('projectGenerator.apiBasePath', '/api/v1'),
            port: config.get<number>('projectGenerator.port', 3000),
            typescript: language === 'typescript',
            includeDocker: config.get<boolean>('projectGenerator.includeDocker', true),
            includeTests: config.get<boolean>('projectGenerator.includeTests', true),
            includeApiExplorer: config.get<boolean>('projectGenerator.includeApiExplorer', true),
            nodeVersion: config.get<string>('projectGenerator.nodeVersion', '>=18.0.0'),
        };
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
        const configured = config.get<string>('projectGenerator.outputDirectory', '').trim();
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
}

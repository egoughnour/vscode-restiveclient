import { commands, QuickPickItem, Uri, window, workspace } from 'vscode';
import * as path from 'path';
import * as fs from 'fs-extra';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseHttpFileToIR } from '../utils/irGenerator';
import { generateOpenApiYaml } from '../utils/openApiGenerator';
import { getCurrentHttpFileName, getCurrentTextDocument } from '../utils/workspaceUtility';

const execFileAsync = promisify(execFile);

type LanguageOption = 'typescript' | 'javascript';

interface GeneratorSettings {
    defaultLanguage: LanguageOption;
    useYarn: boolean;
    includeDocker: boolean;
    yoCommand: string;
    javascriptGenerator: string;
    typescriptGenerator: string;
}

interface ConfigValue<T> {
    value: T;
    isExplicit: boolean;
}

interface PickOption<T> extends QuickPickItem {
    value: T;
}

export class ExternalGeneratorController {
    public async run() {
        const document = getCurrentTextDocument();
        if (!document) {
            window.showErrorMessage('Open a .http file before generating an Express project.');
            return;
        }

        if (document.languageId !== 'http') {
            window.showErrorMessage('External generation is only supported for .http files.');
            return;
        }

        const settings = this.readSettings(document.uri);

        const missingDefaults = this.getMissingDefaults(settings, document.uri);
        if (missingDefaults.length > 0) {
            const choice = await window.showQuickPick([
                {
                    label: 'Open Settings',
                    description: 'Configure external generator defaults first',
                    value: 'settings',
                },
                {
                    label: 'Continue',
                    description: 'Use interactive prompts for this run',
                    value: 'continue',
                },
            ], {
                placeHolder: `Missing defaults: ${missingDefaults.join(', ')}`,
            });

            if (!choice) {
                return;
            }

            if ((choice as PickOption<string>).value === 'settings') {
                await commands.executeCommand('workbench.action.openSettings', 'restive-client.externalGenerator');
                return;
            }
        }

        const appName = await this.pickAppName(document);
        if (!appName) {
            return;
        }

        const language = await this.pickLanguage(settings.defaultLanguage, settings);
        if (!language) {
            return;
        }

        const useYarn = await this.pickFlag(
            'Use Yarn?',
            settings.useYarn,
            'Use Yarn (--yarn)',
            'Use npm (no --yarn)'
        );
        if (useYarn === undefined) {
            return;
        }

        const includeDocker = await this.pickFlag(
            'Include Docker support?',
            settings.includeDocker,
            'Include Docker (--docker)',
            'Skip Docker (no --docker)'
        );
        if (includeDocker === undefined) {
            return;
        }

        const yamlUri = await this.pickOpenApiPath(appName, document.uri);
        if (!yamlUri) {
            return;
        }

        let openApiYaml = '';
        try {
            const basePath = path.dirname(document.uri.fsPath);
            const fileIR = await parseHttpFileToIR(document.getText(), { basePath });
            if (fileIR.operations.length === 0) {
                window.showErrorMessage('No named requests found. Add @name to requests before generating.');
                return;
            }
            openApiYaml = generateOpenApiYaml(fileIR, { title: appName });

            await fs.ensureDir(path.dirname(yamlUri.fsPath));
            await fs.writeFile(yamlUri.fsPath, openApiYaml, 'utf8');
        } catch (error) {
            window.showErrorMessage(`Failed to generate OpenAPI YAML: ${String(error)}`);
            return;
        }

        const generatorName = language === 'typescript'
            ? settings.typescriptGenerator
            : settings.javascriptGenerator;

        const terminalCwd = this.getTerminalCwd(document.uri.fsPath);
        const yoAvailable = await this.checkYoAvailable(settings.yoCommand, terminalCwd);
        if (!yoAvailable) {
            window.showErrorMessage(
                `Could not find "${settings.yoCommand}". Install it first (npm i -g yo).`
            );
            return;
        }

        const generatorAvailable = await this.checkGeneratorAvailable(
            settings.yoCommand,
            generatorName,
            terminalCwd
        );
        if (!generatorAvailable) {
            const installName = generatorName.startsWith('generator-')
                ? generatorName
                : `generator-${generatorName}`;
            window.showErrorMessage(
                `Could not detect "${generatorName}". Install it first (npm i -g ${installName}).`
            );
            return;
        }

        const command = this.buildYoCommand(settings.yoCommand, generatorName, appName, useYarn, includeDocker);
        const terminal = window.createTerminal({
            name: 'Restive Client: Express Generator',
            cwd: terminalCwd,
        });
        terminal.show();
        terminal.sendText(command, true);

        window.showInformationMessage(
            `OpenAPI YAML saved to ${yamlUri.fsPath}. Use this path if the generator prompts for a spec file.`
        );
    }

    private readSettings(uri: Uri): GeneratorSettings {
        const config = workspace.getConfiguration('restive-client', uri);
        return {
            defaultLanguage: this.getConfigValue(config, 'externalGenerator.defaultLanguage', 'typescript').value,
            useYarn: this.getConfigValue(config, 'externalGenerator.useYarn', false).value,
            includeDocker: this.getConfigValue(config, 'externalGenerator.includeDocker', false).value,
            yoCommand: this.getConfigValue(config, 'externalGenerator.yoCommand', 'yo').value,
            javascriptGenerator: this.getConfigValue(
                config,
                'externalGenerator.javascriptGenerator',
                'express-no-stress'
            ).value,
            typescriptGenerator: this.getConfigValue(
                config,
                'externalGenerator.typescriptGenerator',
                'express-no-stress-typescript'
            ).value,
        };
    }

    private getMissingDefaults(settings: GeneratorSettings, uri: Uri): string[] {
        const config = workspace.getConfiguration('restive-client', uri);
        const missing: string[] = [];

        if (!this.getConfigValue(config, 'externalGenerator.defaultLanguage', settings.defaultLanguage).isExplicit) {
            missing.push('defaultLanguage');
        }
        if (!this.getConfigValue(config, 'externalGenerator.useYarn', settings.useYarn).isExplicit) {
            missing.push('useYarn');
        }
        if (!this.getConfigValue(config, 'externalGenerator.includeDocker', settings.includeDocker).isExplicit) {
            missing.push('includeDocker');
        }

        return missing;
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

    private async pickAppName(document: { uri: Uri }): Promise<string | undefined> {
        const suggestions = new Set<string>();
        const workspaceFolder = workspace.getWorkspaceFolder(document.uri);
        if (workspaceFolder) {
            suggestions.add(path.basename(workspaceFolder.uri.fsPath));
        }

        const fileName = getCurrentHttpFileName();
        if (fileName) {
            suggestions.add(fileName);
        }

        const items: PickOption<string>[] = Array.from(suggestions).map(name => ({
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

    private async pickLanguage(
        defaultLanguage: LanguageOption,
        settings: GeneratorSettings
    ): Promise<LanguageOption | undefined> {
        const items: Array<PickOption<LanguageOption>> = [
            {
                label: 'TypeScript',
                description: settings.typescriptGenerator,
                value: 'typescript',
            },
            {
                label: 'JavaScript',
                description: settings.javascriptGenerator,
                value: 'javascript',
            },
        ];

        const defaultItem = items.find(item => item.value === defaultLanguage);
        const selected = await this.showQuickPick(items, 'Select generator language', defaultItem);
        return selected?.value;
    }

    private async pickFlag(
        title: string,
        defaultValue: boolean,
        trueLabel: string,
        falseLabel: string
    ): Promise<boolean | undefined> {
        const items: Array<PickOption<boolean>> = [
            { label: trueLabel, value: true },
            { label: falseLabel, value: false },
        ];

        const defaultItem = items.find(item => item.value === defaultValue);
        const selected = await this.showQuickPick(items, title, defaultItem);
        return selected?.value;
    }

    private async pickOpenApiPath(appName: string, sourceUri: Uri): Promise<Uri | undefined> {
        const workspaceFolder = workspace.getWorkspaceFolder(sourceUri);
        const baseDir = workspaceFolder?.uri.fsPath ?? path.dirname(sourceUri.fsPath);
        const safeName = appName.replace(/[\\/]/g, '-');
        const suggestedName = `${safeName}-openapi.yaml`;
        const defaultUri = Uri.file(path.join(baseDir, suggestedName));

        return window.showSaveDialog({
            defaultUri,
            saveLabel: 'Save OpenAPI YAML',
            filters: {
                'YAML': ['yaml', 'yml'],
            },
        });
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

    private async checkYoAvailable(yoCommand: string, cwd: string): Promise<boolean> {
        try {
            await execFileAsync(yoCommand, ['--version'], { cwd });
            return true;
        } catch {
            return false;
        }
    }

    private async checkGeneratorAvailable(
        yoCommand: string,
        generatorName: string,
        cwd: string
    ): Promise<boolean> {
        try {
            const { stdout, stderr } = await execFileAsync(yoCommand, ['--generators'], { cwd });
            const combined = `${stdout}\n${stderr}`.toLowerCase();
            return combined.includes(generatorName.toLowerCase());
        } catch {
            return false;
        }
    }

    private buildYoCommand(
        yoCommand: string,
        generatorName: string,
        appName: string,
        useYarn: boolean,
        includeDocker: boolean
    ): string {
        const args: string[] = [generatorName, appName];
        if (useYarn) {
            args.push('--yarn');
        }
        if (includeDocker) {
            args.push('--docker');
        }

        return [yoCommand, ...args.map(arg => this.quoteArgument(arg))].join(' ');
    }

    private quoteArgument(value: string): string {
        if (/^[a-zA-Z0-9_./-]+$/.test(value)) {
            return value;
        }
        const escaped = value.replace(/(["\\$`])/g, '\\$1');
        return `"${escaped}"`;
    }

    private getTerminalCwd(filePath: string): string {
        const workspaceFolder = workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath ?? path.dirname(filePath);
    }
}

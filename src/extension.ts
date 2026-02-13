// <reference path="E:/Github/vscode/src/vscode-dts/vscode.d.ts" />
// <reference path="E:/Github/vscode/src/vscode-dts/vscode.proposed.debugLaunchName.d.ts" />

import * as vscode from 'vscode';
import { TasksShared, TaskTreeProvider, Item, CustomItem, editJSON, escapeRegex } from './tasktree';

async function getNpmScripts(workspace: vscode.WorkspaceFolder): Promise<CustomItem[]> {
	const items: CustomItem[] = [];
	const packagePath	= vscode.Uri.joinPath(workspace.uri, 'package.json');
	const json			= JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(packagePath)).toString('utf8'));

	// Create items for each npm script
	if (json.scripts && typeof json.scripts === 'object') {
		for (const [scriptName, scriptCommand] of Object.entries(json.scripts)) {
			if (typeof scriptCommand === 'string') {
				items.push({
					title:		scriptName,
					group:		'npm',
					workspace,
					icon:		new vscode.ThemeIcon('terminal'),
					tooltip:	new vscode.MarkdownString(`**${scriptName}**\n\n\`\`\`bash\n${scriptCommand}\n\`\`\``),
					run: () => {
						const task = new vscode.Task(
							{ type: 'npm', script: scriptName },
							workspace,
							`npm: ${scriptName}`,
							'npm',
							new vscode.ShellExecution('npm', ['run', scriptName])
						);
						vscode.tasks.executeTask(task);
					},
					edit: () => {
						editJSON(packagePath, new RegExp(`(?<=\\n\\s*"${escapeRegex(scriptName)}"\\s*:)`, 'm'));
					}
				});
			}
		}
	}
	return items;
}

class Watchers implements vscode.Disposable {
	private watchers: vscode.FileSystemWatcher[] = [];
	private debounceTimeout?: NodeJS.Timeout;

	constructor(private onDidChange: (e: vscode.Uri) => void) {
	}

	private debouncedCallback = (uri: vscode.Uri) => {
		if (this.debounceTimeout)
			clearTimeout(this.debounceTimeout);

		this.debounceTimeout = setTimeout(() => {
			this.debounceTimeout = undefined;
			this.onDidChange(uri);
		}, 250); // 250ms debounce
	};

	set(patterns: vscode.GlobPattern[]) {
		this.clear();
		this.watchers = patterns.map(pattern => {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);
			watcher.onDidChange(this.debouncedCallback);
			watcher.onDidCreate(this.debouncedCallback);
			watcher.onDidDelete(this.debouncedCallback);
			return watcher;
		});
	}
	
	clear() {
		if (this.debounceTimeout) {
			clearTimeout(this.debounceTimeout);
			this.debounceTimeout = undefined;
		}
		this.watchers.forEach(w => w.dispose());
		this.watchers = [];
	}
	dispose() {
		this.clear();
	}
}

//-----------------------------------------------------------------------------
// entry
//-----------------------------------------------------------------------------

function activate(context: vscode.ExtensionContext) {
	//const launchConfig	= vscode.debug.configuration;
	//console.log("Initial launchName is", launchConfig?.name);
	//vscode.debug.onDidChangeConfiguration(config => console.log("Changed to", config.configuration?.name));

	const shared		= new TasksShared(context);
	const taskTree		= new TaskTreeProvider(shared, true, false);
	const launchTree	= new TaskTreeProvider(shared, false, true);

	const config		= vscode.workspace.getConfiguration('taskviewer');
	config.inspect('groupByWorkspace');

	const setContext		= (name: 'showLaunches'|'showAll'|'groupByWorkspace', value: boolean) => {
		vscode.commands.executeCommand("setContext", "taskviewer." + name, taskTree[name] = value);
	};
	const setLaunchContext	= (name: 'groupByWorkspace', value: boolean) => {
		vscode.commands.executeCommand("setContext", "launchviewer." + name, launchTree[name] = value);
	};
	
	const setContextFromConfig = (config: vscode.WorkspaceConfiguration) => {
		setContext('showAll',					config.get('showAll', false));
		setContext('showLaunches',				config.get('showLaunches', false));
		setContext('groupByWorkspace',			config.get('groupByWorkspace', false));
		setLaunchContext('groupByWorkspace',	config.get('launch.groupByWorkspace', false));
	};

	const setConfig		= (name: 'showLaunches'|'showAll'|'groupByWorkspace', value: boolean) => {
		setContext(name, value);
		taskTree.refresh();
		config.update(name, value);
	};
	const setLaunchConfig	= (name: 'groupByWorkspace', value: boolean) => {
		setLaunchContext(name, value);
		launchTree.refresh();
		config.update('launch.' + name, value);
	};

	vscode.commands.executeCommand("setContext", 'taskviewer.multiroot', shared.multiRoot);

	setContextFromConfig(config);

	// Register npm scripts provider
	if (vscode.workspace.workspaceFolders) {
		const watchers = new Watchers(shared.refresh);
		
		// Use RelativePattern for each workspace folder
		const updateWatchers = () => watchers.set(vscode.workspace.workspaceFolders?.map(folder => new vscode.RelativePattern(folder, 'package.json')) ?? []);
		updateWatchers();
		
		context.subscriptions.push(
			watchers,
			vscode.workspace.onDidChangeWorkspaceFolders(updateWatchers)
		);
		
		shared.registerProvider({
			provideItems: () => Promise.all(vscode.workspace.workspaceFolders!.map(folder => getNpmScripts(folder).catch(_error => []))).then(items => items.flat())
		});
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('taskviewer')) {
				setContextFromConfig(vscode.workspace.getConfiguration('taskviewer'));
				taskTree.refresh();
				launchTree.refresh();
			}
		}),

		vscode.window.registerTreeDataProvider('taskviewer.view', taskTree),
		vscode.window.registerTreeDataProvider('launchviewer.view', launchTree),

		vscode.commands.registerCommand('taskviewer.run',	(item: Item) =>
			item.run()
		),
		vscode.commands.registerCommand('taskviewer.edit',	(item: Item) =>
			item.edit()
		),
		vscode.commands.registerCommand('taskviewer.stop',	(item: Item) =>
			shared.stop(item)
		),

		vscode.commands.registerCommand('taskviewer.refresh', () => {
			shared.refresh();
			taskTree.refresh();
		}),
		vscode.commands.registerCommand('taskviewer.showLaunches',	() => setConfig('showLaunches', true)),
		vscode.commands.registerCommand('taskviewer.hideLaunches',	() => setConfig('showLaunches', false)),

		vscode.commands.registerCommand('taskviewer.showAll',		() => setConfig('showAll', true)),
		vscode.commands.registerCommand('taskviewer.showConfig',	() => setConfig('showAll', false)),

		vscode.commands.registerCommand('taskviewer.groupByWorkspace',	() => setConfig('groupByWorkspace', true)),
		vscode.commands.registerCommand('taskviewer.ungroupByWorkspace',() => setConfig('groupByWorkspace', false)),

		vscode.commands.registerCommand('launchviewer.refresh', () => {
			shared.refresh();
			launchTree.refresh();
		}),
		vscode.commands.registerCommand('launchviewer.groupByWorkspace',	() => setLaunchConfig('groupByWorkspace', true)),
		vscode.commands.registerCommand('launchviewer.ungroupByWorkspace',	() => setLaunchConfig('groupByWorkspace', false)),
	);

	return shared;
}

//export function deactivate(): void {}
module.exports = { activate };
export type { CustomItem, TasksShared as exports} from './tasktree';


import * as vscode from 'vscode';

//-----------------------------------------------------------------------------
// Configurations
//-----------------------------------------------------------------------------

interface TaskConfiguration {
	label?:		string;
	script?:	string;
	task?:		string;
	dependsOn?:	string | string[];
	type:		string;
	isBackground?: boolean;
	problemMatcher?: string | string[];
	group?: string | {
		kind: 		string;
	  	isDefault?: boolean;
	};
	detail?: string;
	presentation?: {
	  reveal?:	"always" | "silent" | "never";
	  group?:	string;
	  echo?:	boolean;
	  close?:	boolean;
	};
}

interface LaunchConfigurationBase {
	type: 			string;
	name:			string;
	preLaunchTask?:	string;
	postDebugTask?:	string;
	presentation?: {
		order:		number;
		group:		string;
		hidden:		boolean;
	};
}

interface LaunchConfiguration extends LaunchConfigurationBase {
	request:		string;
}

interface CompoundLaunchConfiguration extends LaunchConfigurationBase {
	configurations:	string[];
	stopAll?:		boolean;
}

export type TaskItem =
	{type: 'group',
		name:		string,
		icon:		vscode.ThemeIcon,
		entries:	TaskItem[],
	}
 |	{type: 'task',		task:		TaskConfiguration}
 |	{type: 'launch', 	launch:		LaunchConfiguration}
 |	{type: 'compound',	compound:	CompoundLaunchConfiguration};


function getName(task: TaskConfiguration) : string {
	return task.label ?? task.script ?? task.task ?? '';
}

function findWorkspace(name: string, configuration: string, entries: string, matchFields: string[]) : vscode.WorkspaceFolder | undefined {
	if (vscode.workspace.workspaceFolders) {
		for (const i of vscode.workspace.workspaceFolders) {
			const config = vscode.workspace.getConfiguration(configuration, i.uri);
			const values = config.get<any[]>(entries);
			if (values) {
				for (const j of values) {
					const field = matchFields.find(f => j[f] === name);
					if (field) {
						matchFields[0] = field;
						return i;
					}
				}
			}
		}
	}
}

function editConfig(name: string, configuration: string, entries: string, matchFields: string[]) {
	const ws = findWorkspace(name, configuration, entries, matchFields);
	if (ws) {
		const uri = vscode.Uri.joinPath(ws.uri, `.vscode/${configuration}.json`);
		vscode.workspace.openTextDocument(uri).then(document => {
			const match = (new RegExp(`"${matchFields[0]}":\\s*"${name}"`, 'g')).exec(document.getText());
			if (match) {
				const position = document.positionAt(match.index);
				vscode.window.showTextDocument(document, {selection: new vscode.Range(position, position)});
			}
		});
	}
}

class Configurations {
	launches:		LaunchConfiguration[]			= [];
	compounds: 		CompoundLaunchConfiguration[]	= [];
	tasks:			TaskConfiguration[]				= [];

	refresh() {
		this.launches 	= [];
		this.compounds 	= [];
		this.tasks 		= [];

		if (vscode.workspace.workspaceFolders) {
			for (const i of vscode.workspace.workspaceFolders) {
				const config = vscode.workspace.getConfiguration('launch', i.uri);
				this.launches.push(...(config.get<LaunchConfiguration[]>('configurations') || []));
				this.compounds.push(...(config.get<CompoundLaunchConfiguration[]>('compounds') || []));

				const config2 = vscode.workspace.getConfiguration('tasks', i.uri);
				this.tasks.push(...(config2.get<TaskConfiguration[]>('tasks') || []));
			}
		}
	}
}

//-----------------------------------------------------------------------------
// TasksShared
//-----------------------------------------------------------------------------

const CACHE_TIMEOUT = 5000;

interface TaskStatus {
	isActive:	boolean;
	status?:	string;
	execution?:	vscode.TaskExecution;
}

class TasksShared {
	private status: 	Record<string, TaskStatus> = {};
	private tasks?: 	Thenable<Record<string, vscode.Task>>;
	private icons:		Record<string, string> = {};
	private colors:		Record<string, string> = {};

	configs	= new Configurations;

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(

			vscode.commands.registerCommand('tasks.stop',	(item: TaskItem) => {
				if (item.type === 'task')
					this.status[getName(item.task)]?.execution?.terminate();
			}),

			vscode.commands.registerCommand('tasks.run',	(item: TaskItem) => {
				switch (item.type) {
					case 'task': {
						this.getTask(getName(item.task)).then(task => task && vscode.tasks.executeTask(task));
						break;
					}
					case 'launch':
						const ws = findWorkspace(item.launch.name, 'launch', 'configurations', ['name']);
						vscode.debug.startDebugging(ws, item.launch);
						break;
					case 'compound':
						const ws2 = findWorkspace(item.compound.name, 'launch', 'compounds', ['name']);
						vscode.debug.startDebugging(ws2, item.compound.name);
						break;
				}
			}),

			vscode.commands.registerCommand('tasks.edit',	(item: TaskItem) => {
				switch (item.type) {
					case 'task':
						editConfig(getName(item.task), 'tasks', 'tasks', ['label', 'task', 'script']);
						break;
					case 'launch':
						editConfig(item.launch.name, 'launch', 'configurations', ['name']);
						break;
					case 'compound':
						editConfig(item.compound.name, 'launch', 'compounds', ['name']);
						break;
				}
			})

		);

	
		this.refresh();
	}

	getIconName(name: string, group?: string): string {
		for (const [key, value] of Object.entries(this.icons)) {
			if (name.includes(key))
				return value;
		}
		return (group && this.icons[group]) || this.icons.default;
	}
	
	getColorFromType(type: string): string {
		return this.colors[type] ?? this.colors.default;

	}
		
	started(execution: vscode.TaskExecution) {
		this.status[execution.task.name] = {
			isActive: true,
			status: 'Running',
			execution
		};
	}

	stopped(task: vscode.Task, exitCode?: number) {
		this.status[task.name] = {
			isActive: false,
			status: exitCode === undefined ? 'Stopped' : (exitCode === 0 ? 'Success' : `Failed (${exitCode})`)
		};
	}
	
	async getTask(name: string) : Promise<vscode.Task|undefined> {
		if (!this.tasks) {
			this.tasks 	= vscode.tasks.fetchTasks().then(tasks => {
				setTimeout(()=> this.tasks = undefined, CACHE_TIMEOUT);
				return Object.fromEntries(tasks.filter(task => task.source === 'Workspace' || (task as any)._source?.kind === 2).map(task => [task.name, task]));
			});
		}
		const tasks = await this.tasks;
		return tasks[name];
	}

	getStatus(name: string) : TaskStatus | undefined {
		return this.status[name];
	}

	refresh() {
		this.status		= {};
		this.tasks = undefined;
		const config	= vscode.workspace.getConfiguration('taskview');
		this.icons		= config.icons;
		this.colors		= config.colors;
		this.configs.refresh();
	}

}

//-----------------------------------------------------------------------------
// TaskTreeProvider
//-----------------------------------------------------------------------------

function makeTreeItem(name: string, icon_name: string, icon_color: string, arg: TaskItem) {
	const titem = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);
	titem.command = {
		command: 'tasks.run',
		title: '',
		arguments: [arg]
	};
	titem.iconPath	= new vscode.ThemeIcon(
		icon_name,
		new vscode.ThemeColor(icon_color)
	);
	return titem;
}

class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TaskItem | undefined | null | void>();
	get onDidChangeTreeData() { return this._onDidChangeTreeData.event; }
	
	constructor(private shared: TasksShared, public showTasks: boolean, public showLaunches: boolean) {
	}

	refresh(item?: TaskItem) {
		this._onDidChangeTreeData.fire(item);
	}

	getTreeItem(item: TaskItem): vscode.TreeItem {
		switch (item.type) {
			case 'group': {
				const titem = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.Expanded);
				titem.iconPath = new vscode.ThemeIcon(this.shared.getIconName(item.name));//item.icon;
				titem.contextValue = 'noedit';
				return titem;
			}
			case 'task': {
				const task = item.task;
				const status = this.shared.getStatus(getName(task));
				const icon	= status?.isActive ? 'sync~spin' : this.shared.getIconName(getName(task).toLowerCase(), (typeof task.group === 'string' ? task.group.toLowerCase() : task.group?.kind.toLowerCase()));
				const color = this.shared.getColorFromType(task.type?.toLowerCase() ?? '');

				const titem = makeTreeItem(getName(task), icon, color, item);

				titem.description	= status?.status;
				titem.contextValue	= status?.isActive ? 'running' : 'task';

				const tooltip = new vscode.MarkdownString('', true);
				tooltip.isTrusted	= true;
				tooltip.supportHtml = true;
				tooltip.appendMarkdown(`**Type:** ${task.type}\n\n`);
				if (task.detail)
					tooltip.appendMarkdown(`**Detail:** ${task.detail}\n\n`);
				
				titem.tooltip = tooltip;
				return titem;
			}
			case 'launch':
				return makeTreeItem(item.launch.name, 'debug-alt', this.shared.getColorFromType(item.launch.type.toLowerCase()), item);

			case 'compound':
				return makeTreeItem(item.compound.name, 'run-all', this.shared.getColorFromType('compound'), item);
		}
	}

	async getChildren(item?: TaskItem): Promise<TaskItem[]> {
		if (!item) {
			const groups: Record<string, TaskItem[]> = {};

			// sort into groups

			if (this.showTasks) {
				this.shared.configs.tasks.forEach(i => {
					//const group = groups[i.presentation?.group ?? (typeof i.group === 'string' ? i.group : i.group?.kind) ?? ''] ??= [];
					const group = groups[(typeof i.group === 'string' ? i.group : i.group?.kind) ?? ''] ??= [];
					group.push({type: 'task', task: i});
				});
			}

			if (this.showLaunches) {
				this.shared.configs.launches.forEach(i => {
					const group = groups[i.presentation?.group ?? ''] ??= [];
					group.push({type: 'launch', launch: i});
				});
				this.shared.configs.compounds.forEach(i => {
					const group = groups[i.presentation?.group ?? ''] ??= [];
					group.push({type: 'compound', compound: i});
				});
			}

			if (groups['']) {
				groups[''].filter(i => (groups[i.type ?? ''] ??= []).push(i));
				delete groups[''];
			}

			const get_order0 = (item: TaskItem) => {
				switch (item.type) {
					//case 'task':		return item.task.definition.presentation?.order;
					case 'launch':		return item.launch.presentation?.order;
					case 'compound':	return item.compound.presentation?.order;
				}
			}
			const get_order = (item: TaskItem) => get_order0(item)  ?? 10000;

			const groups2 = Object.entries(groups).map(([key, value]) => {
				return {
					type: 'group' as const,
					name: key,
					icon: new vscode.ThemeIcon("gear"),
					entries: value.sort((a, b) => get_order(a) - get_order(b))
				};
			}).sort((a, b) => (a.name > b.name) ? 1 : -1);

			for (const i of groups2) {
				const match = i.name.match(/^\d+_(.*)/)
				if (match)
					i.name = match[1];
			}

			return groups2;

		}
		return item.type === 'group'
			? item.entries
			: [];
	}
}

//-----------------------------------------------------------------------------
// entry
//-----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
	const shared		= new TasksShared(context);
	const taskTree		= new TaskTreeProvider(shared, true, false);
	const launchTree	= new TaskTreeProvider(shared, false, true);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('tasks.view', taskTree),
		vscode.window.registerTreeDataProvider('tasks.launchView', launchTree),

		vscode.commands.registerCommand('tasks.refresh', () => {
			shared.refresh();
			taskTree.refresh();
		}),
		vscode.commands.registerCommand('tasks.showLaunches', () => {
			taskTree.showLaunches = !taskTree.showLaunches;
			taskTree.refresh();
		}),

		vscode.commands.registerCommand('tasks.launchRefresh', () => {
			shared.refresh();
			launchTree.refresh();
		}),

		vscode.tasks.onDidStartTaskProcess(e => {
			if (e.execution.task) {
				shared.started(e.execution);
				taskTree.refresh();
			}
		}),

		vscode.tasks.onDidEndTaskProcess(e => {
			if (e.execution.task) {
				shared.stopped(e.execution.task, e.exitCode);
				taskTree.refresh();
			}
		}),
	);

}

//export function deactivate(): void {}

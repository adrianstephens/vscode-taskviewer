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


//-----------------------------------------------------------------------------
// TaskItem
//-----------------------------------------------------------------------------

abstract class TaskItem {
	abstract type: string;
	abstract name: string;
	get order():	number | undefined { return undefined; }
	icontype():		string	{ return this.type; }
	colortype():	string	{ return ''; }
	group(): 		string	{ return ''; }
	tooltip(): 		vscode.MarkdownString | undefined { return undefined }
	run?():void;
	edit()	{}
	hasChildren() 			{ return false; }
	children(): TaskItem[]	{ return []; }
}

class TaskItemGroup extends TaskItem {
	constructor(public name: string, private entries: TaskItem[]) { super(); }
	get type()		{ return 'group'; }
	icontype()		{ return this.name; }
	hasChildren()	{ return true; }
	children()		{ return this.entries; }
}

const CACHE_TIMEOUT = 5000;

class TaskGetter {
	static tasks?: Thenable<Record<string, vscode.Task>>;

	static getTasks() {
		if (!this.tasks) {
			this.tasks 	= vscode.tasks.fetchTasks().then(tasks => {
				setTimeout(()=> this.tasks = undefined, CACHE_TIMEOUT);
				return Object.fromEntries(tasks.map(task => [task.name, task]));
			});
		}
		return this.tasks;
	}
	static async getTask(name: string) : Promise<vscode.Task|undefined> {
		return (await this.getTasks())[name];
	}
}

abstract class TaskItemTaskBase extends TaskItem {
	get type()	{ return 'task'; }
	run()	{ TaskGetter.getTask(this.name).then(task => task && vscode.tasks.executeTask(task)); }
	edit()	{ editConfig(this.name, 'tasks', 'tasks', ['label', 'task', 'script']); }
}

class TaskItemTaskConfig extends TaskItemTaskBase {
	constructor(private config: TaskConfiguration) { super(); }
	get name()	{ return this.config.label ?? this.config.script ?? this.config.task ?? ''; }

	icontype()	{ return this.name.toLowerCase(); }
	colortype()	{ return this.config.type ?? 'compound'; }
	group()		{ return (typeof this.config.group === 'string' ? this.config.group : this.config.group?.kind) ?? ''; }

	tooltip() {
		const tooltip = new vscode.MarkdownString('', true);
		tooltip.isTrusted	= true;
		tooltip.supportHtml = true;
		tooltip.appendMarkdown(`**Type:** ${this.config.type}\n\n`);
		if (this.config.detail)
			tooltip.appendMarkdown(`**Detail:** ${this.config.detail}\n\n`);
		return tooltip;
	}
	hasChildren() { return !!this.config.dependsOn; }
	children()	{
		if (this.config.dependsOn) {
			if (Array.isArray(this.config.dependsOn))
				return this.config.dependsOn.map(name => new TaskItemBefore(name));
			else
				return [new TaskItemBefore(this.config.dependsOn)];
		}
		return [];
	}
}

class TaskItemTask extends TaskItemTaskBase {
	constructor(private task: vscode.Task) { super(); }
	get name()	{ return this.task.name; }

	icontype()	{ return this.name.toLowerCase(); }
	colortype()	{ return this.task.definition.type; }
	group()		{ return this.task.group?.id ?? ''; }

	tooltip() {
		const tooltip = new vscode.MarkdownString('', true);
		tooltip.isTrusted	= true;
		tooltip.supportHtml = true;
		tooltip.appendMarkdown(`**Type:** ${this.task.definition.type}\n\n`);
		if (this.task.detail)
			tooltip.appendMarkdown(`**Detail:** ${this.task.detail}\n\n`);
		return tooltip;
	}
	run()	{ vscode.tasks.executeTask(this.task); }

}

class TaskItemBefore extends TaskItemTaskBase {
	constructor(public name: string) { super(); }
	icontype()	{ return 'before'; }
}
class TaskItemAfter extends TaskItemTaskBase {
	constructor(public name: string) { super(); }
	icontype()	{ return 'after'; }
}

class TaskItemLaunch extends TaskItem {
	constructor(private config: LaunchConfiguration) { super(); }
	get type()	{ return 'launch'; }
	get name()	{ return this.config.name; }
	get order()	{ return this.config.presentation?.order;}
	colortype()	{ return this.config.type; }
	group()		{ return this.config.presentation?.group ?? ''; }

	run() {
		const ws = findWorkspace(this.config.name, 'launch', 'configurations', ['name']);
		vscode.debug.startDebugging(ws, this.config);
	}
	edit() {
		editConfig(this.name, 'launch', 'configurations', ['name']);
	}
	hasChildren() { return !!(this.config.preLaunchTask || this.config.postDebugTask); }
	children()	{
		const children: TaskItem[] = [];
		if (this.config.preLaunchTask)
			children.push(new TaskItemBefore(this.config.preLaunchTask));
		if (this.config.postDebugTask)
			children.push(new TaskItemAfter(this.config.postDebugTask));
		return children;
	}
}

class TaskItemCompound extends TaskItem {
	constructor(private config: CompoundLaunchConfiguration) { super(); }
	get type()	{ return 'compound'; }
	get name()	{ return this.config.name; }
	get order()	{ return this.config.presentation?.order;}
	colortype()	{ return 'compound'; }
	group()		{ return this.config.presentation?.group ?? ''; }

	run() {
		const ws = findWorkspace(this.config.name, 'launch', 'compounds', ['name']);
		vscode.debug.startDebugging(ws, this.config.name);
	}
	edit() {
		editConfig(this.name, 'launch', 'compounds', ['name']);
	}
	hasChildren()	{ return true; }
	children()		{ return this.config.configurations.map(name => new TaskItemLaunch({type: 'compound', name, request:''})); }
}

//-----------------------------------------------------------------------------
// TasksShared
//-----------------------------------------------------------------------------

interface TaskStatus {
	isActive:	boolean;
	status?:	string;
	execution?:	vscode.TaskExecution;
}
interface LaunchStatus {
	session:	vscode.DebugSession;
}

class TasksShared {
	private status: 		Record<string, TaskStatus> = {};
	private debugStatus:	Record<string, LaunchStatus> = {};
	private icons:			Record<string, string> = {};
	private colors:			Record<string, string> = {};

	launches:		LaunchConfiguration[]			= [];
	compounds: 		CompoundLaunchConfiguration[]	= [];
	taskConfigs:	TaskConfiguration[]				= [];

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('taskviewer.stop',	(item: TaskItem) => {
				if (item.type === 'task')
					this.status[item.name]?.execution?.terminate();
				else if (item.type === 'launch') {
					console.log(`stop ${item.name}`)
					vscode.debug.stopDebugging(this.debugStatus[item.name].session);
				}
			}),
		);
	
		this.updateSettings();
		this.refresh();
	}

	getIconName(name: string) {
		for (const [key, value] of Object.entries(this.icons)) {
			if (name.includes(key))
				return value;
		}
		return this.icons.default;
	}
	
	getColorFromType(type: string): string {
		return this.colors[type] ?? this.colors.default;

	}
		
	startedTask(execution: vscode.TaskExecution) {
		this.status[execution.task.name] = {
			isActive: true,
			status: 'Running',
			execution
		};
	}

	stoppedTask(task: vscode.Task, exitCode?: number) {
		this.status[task.name] = {
			isActive: false,
			status: exitCode === undefined ? 'Stopped' : (exitCode === 0 ? 'Success' : `Failed (${exitCode})`)
		};
	}
	startedDebug(session: vscode.DebugSession) {
		console.log(`started ${session.name}`)
		this.debugStatus[session.name] = {session};
	}
	stoppedDebug(session: vscode.DebugSession) {
		console.log(`stopped ${session.name}`)
		delete this.debugStatus[session.name];
	}

	getStatus(name: string) : TaskStatus | undefined {
		return this.status[name];
	}
	isDebugging(name: string) : boolean {
		return name in this.debugStatus;
	}

	updateSettings() {
		const config	= vscode.workspace.getConfiguration('taskviewer');
		this.icons		= config.icons;
		this.colors		= config.colors;
	}
	refresh() {
		this.status		= {};
		this.launches 		= [];
		this.compounds		= [];
		this.taskConfigs	= [];

		if (vscode.workspace.workspaceFolders) {
			for (const i of vscode.workspace.workspaceFolders) {
				const config = vscode.workspace.getConfiguration('launch', i.uri);
				this.launches.push(...(config.get<LaunchConfiguration[]>('configurations') || []));
				this.compounds.push(...(config.get<CompoundLaunchConfiguration[]>('compounds') || []));

				const config2 = vscode.workspace.getConfiguration('tasks', i.uri);
				this.taskConfigs.push(...(config2.get<TaskConfiguration[]>('tasks') || []));
			}
		}
	}

}

//-----------------------------------------------------------------------------
// TaskTreeProvider
//-----------------------------------------------------------------------------

function makeTreeItem(item: TaskItem, icon_name: string, icon_color: string) {
	const titem = new vscode.TreeItem(item.name, item.hasChildren() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
	if (item.run)
		titem.command = {
			command: 'taskviewer.run',
			title: '',
			arguments: [item]
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

	public allTasks = false;
	
	constructor(private shared: TasksShared, public showTasks: boolean, public showLaunches: boolean) {
	}

	refresh(item?: TaskItem) {
		this._onDidChangeTreeData.fire(item);
	}

	getTreeItem(item: TaskItem): vscode.TreeItem {
		switch (item.type) {
			default:
			case 'group': {
				const titem = new vscode.TreeItem(item.name, vscode.TreeItemCollapsibleState.Expanded);
				titem.iconPath = new vscode.ThemeIcon(this.shared.getIconName(item.icontype()));
				titem.contextValue = 'noedit';
				return titem;
			}
			case 'task': {
				const status = this.shared.getStatus(item.name);
				const icon	= status?.isActive ? 'sync~spin' : this.shared.getIconName(item.icontype());
				const color = this.shared.getColorFromType(item.colortype().toLowerCase());

				const titem = makeTreeItem(item, icon, color);

				titem.description	= status?.status;
				titem.contextValue	= status?.isActive ? 'running' : 'task';
				titem.tooltip = item.tooltip()
				return titem;
			}
			case 'launch': {
				const status = this.shared.isDebugging(item.name);
				const icon	= status ? 'sync~spin' : 'debug-alt';
				const titem = makeTreeItem(item, icon, this.shared.getColorFromType(item.colortype()));
				titem.contextValue	= status ? 'running' : 'launch';
				return titem;
			}

			case 'compound':
				return makeTreeItem(item, 'run-all', this.shared.getColorFromType(item.colortype()));
		}
	}

	async getChildren(item?: TaskItem): Promise<TaskItem[]> {
		if (!item) {
			const groups: Record<string, TaskItem[]> = {};

			// sort into groups

			const addToGroup = (item: TaskItem) => (groups[item.group()] ??= []).push(item);

			if (this.showTasks) {
				if (this.allTasks) {
					const tasks = await TaskGetter.getTasks();

					this.shared.taskConfigs.forEach(i => {
						const item = new TaskItemTaskConfig(i);
						delete tasks[item.name];
						addToGroup(item);
					});

					Object.values(tasks).forEach(i => addToGroup(new TaskItemTask(i)));

				} else {
					this.shared.taskConfigs.forEach(i => addToGroup(new TaskItemTaskConfig(i)));
				}
			}

			if (this.showLaunches) {
				this.shared.launches.forEach(i => addToGroup(new TaskItemLaunch(i)));
				this.shared.compounds.forEach(i => addToGroup(new TaskItemCompound(i)));
			}

			if (groups['']) {
				groups[''].filter(i => (groups[i.type ?? ''] ??= []).push(i));
				delete groups[''];
			}

			const get_order = (item: TaskItem) => item.order ?? 10000;

			const groups2 = Object.entries(groups)
				.map(([key, value]) => new TaskItemGroup(key, value.sort((a, b) => get_order(a) - get_order(b))))
				.sort((a, b) => (a.name > b.name) ? 1 : -1);

			for (const i of groups2) {
				const match = i.name.match(/^\d+_(.*)/)
				if (match)
					i.name = match[1];
			}

			return groups2;

		}
		return item.children();
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
		vscode.window.registerTreeDataProvider('taskviewer.view', taskTree),
		vscode.window.registerTreeDataProvider('taskviewer.launchView', launchTree),

		vscode.commands.registerCommand('taskviewer.refresh', () => {
			shared.refresh();
			taskTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.launchRefresh', () => {
			shared.refresh();
			launchTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.run',	(item: TaskItem) => item.run!()),
		vscode.commands.registerCommand('taskviewer.edit',	(item: TaskItem) => item.edit()),

		vscode.commands.registerCommand('taskviewer.showLaunches', () => {
			vscode.commands.executeCommand("setContext", "taskviewer.launches", taskTree.showLaunches = true);
			taskTree.refresh();
		}),
		vscode.commands.registerCommand('taskviewer.hideLaunches', () => {
			vscode.commands.executeCommand("setContext", "taskviewer.launches", taskTree.showLaunches = false);
			taskTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.showAll',	() => {
			vscode.commands.executeCommand("setContext", "taskviewer.all", taskTree.allTasks = true);
			taskTree.refresh();
		}),
		vscode.commands.registerCommand('taskviewer.showConfig',	() => {
			taskTree.allTasks = true;
			vscode.commands.executeCommand("setContext", "taskviewer.all", taskTree.allTasks = false);
			taskTree.refresh();
		}),


		vscode.tasks.onDidStartTaskProcess(e => {
			if (e.execution.task) {
				shared.startedTask(e.execution);
				taskTree.refresh();
				launchTree.refresh();
			}
		}),

		vscode.tasks.onDidEndTaskProcess(e => {
			if (e.execution.task) {
				shared.stoppedTask(e.execution.task, e.exitCode);
				taskTree.refresh();
				launchTree.refresh();
			}
		}),
		vscode.debug.onDidStartDebugSession(e => {
			shared.startedDebug(e);
			launchTree.refresh();
		}),

		vscode.debug.onDidTerminateDebugSession(e => {
			shared.stoppedDebug(e);
			launchTree.refresh();
		}),
		
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration("taskviewer")) {
				shared.updateSettings();
				taskTree.refresh();
				launchTree.refresh();
			}
		})
	);

}

//export function deactivate(): void {}

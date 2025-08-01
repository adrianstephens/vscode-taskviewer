import * as vscode from 'vscode';

//-----------------------------------------------------------------------------
// Configurations
//-----------------------------------------------------------------------------

interface TaskConfiguration {
	label?:			string;
	script?:		string;
	task?:			string;
	dependsOn?:		string | string[];
	type:			string;
	isBackground?: 	boolean;
	problemMatcher?: string | string[];
	group?:			string | {
		kind: 		string;
	  	isDefault?: boolean;
	};
	detail?:		string;
	presentation?: {
	  reveal?:	"always" | "silent" | "never";
	  group?:		string;
	  echo?:		boolean;
	  close?:		boolean;
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
/*
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
	if (ws)
		return editConfig1(ws, name, configuration, matchFields[0]);
}
*/

function escapeRegex(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escapes all special chars
}

function editConfig1(workspace: vscode.WorkspaceFolder, name: string, configuration: string, matchField: string) {
	const uri = vscode.Uri.joinPath(workspace.uri, `.vscode/${configuration}.json`);
	vscode.workspace.openTextDocument(uri).then(document => {
		const match = (new RegExp(`"${matchField}":\\s*"${escapeRegex(name)}"`, 'g')).exec(document.getText());
		if (match) {
			const position = document.positionAt(match.index);
			vscode.window.showTextDocument(document, {selection: new vscode.Range(position, position)});
		}
	});
}


//-----------------------------------------------------------------------------
// TaskItem
//-----------------------------------------------------------------------------
function taskName(task: vscode.Task) {
	return typeof task.scope === 'object' ? `${task.scope.name}.${task.name}` : task.name;
}

abstract class TaskItem {
	abstract type:	string;
	abstract id:	string;
	get order():	number | undefined { return undefined; }
	title(_multi_workspace: boolean):	string	{ return this.id; }
	icontype():		string	{ return this.type; }
	colortype():	string	{ return ''; }
	group(): 		string	{ return ''; }
	tooltip(): 		vscode.MarkdownString | undefined { return undefined; }
	run?():void;
	edit()					{}
	hasChildren() 			{ return false; }
	children(): TaskItem[]	{ return []; }
}

class TaskItemGroup extends TaskItem {
	constructor(public id: string, private entries: TaskItem[]) { super(); }
	readonly type = 'group';
	icontype()		{ return this.id; }
	hasChildren()	{ return true; }
	children()		{ return this.entries; }
}

class TaskItemWorkspaceGroup extends TaskItemGroup {
//	constructor(public id: string, private entries: TaskItem[]) { super(); }
//	readonly type = 'group';
	icontype()		{ return 'workspace'; }
//	hasChildren()	{ return true; }
//	children()		{ return this.entries; }
}

class GroupHelper {
	groups:	Record<string, TaskItem[]>	= {};
	add(item: TaskItem) {
		(this.groups[item.group()] ??= []).push(item);
	}
	cleanup() {
		const get_order = (item: TaskItem) => item.order ?? 10000;
		const groups = this.groups;

		if (groups['']) {
			groups[''].filter(i => (groups[i.type ?? ''] ??= []).push(i));
			delete groups[''];
		}

		const groups2 = Object.entries(groups)
			.map(([key, value]) => new TaskItemGroup(key, value.sort((a, b) => get_order(a) - get_order(b))))
			.sort((a, b) => (a.id > b.id) ? 1 : -1);

		for (const i of groups2) {
			const match = i.id.match(/^\d+_(.*)/);
			if (match)
				i.id = match[1];
		}

		return groups2;
	}
}

const CACHE_TIMEOUT = 5000;

class TaskGetter {
	static tasks?: Thenable<Record<string, vscode.Task>>;

	static getTasks() {
		if (!this.tasks) {
			this.tasks 	= vscode.tasks.fetchTasks().then(tasks => {
				setTimeout(()=> this.tasks = undefined, CACHE_TIMEOUT);
				return Object.fromEntries(tasks.map(task => [taskName(task), task]));
			});
		}
		return this.tasks;
	}
}

abstract class TaskItemTaskBase extends TaskItem {
	readonly type = 'task';
	run()		{
		TaskGetter.getTasks().then(tasks => {
			const task = tasks[this.id];
			return task && vscode.tasks.executeTask(task);
		});
	}
}

function configName(config: TaskConfiguration) {
	return config.label ?? config.script ?? config.task ?? '';
}
class TaskItemTaskConfig extends TaskItemTaskBase {
	constructor(private config: TaskConfiguration, private workspace: vscode.WorkspaceFolder) { super(); }
	get id()	{ return `${this.workspace.name}.${configName(this.config)}`; }

	title(multi_workspace: boolean)	{
		return multi_workspace ? `${configName(this.config)} (${this.workspace.name})` : configName(this.config);
	}

	edit()		{ editConfig1(this.workspace, configName(this.config), 'tasks', '(?:label|task|script)'); }

	icontype()	{ return this.id.toLowerCase(); }
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
				return this.config.dependsOn.map(name => new TaskItemBefore(name, this.workspace));
			else
				return [new TaskItemBefore(this.config.dependsOn, this.workspace)];
		}
		return [];
	}
}

class TaskItemTask extends TaskItemTaskBase {
	constructor(private task: vscode.Task) { super(); }
	get id()	{ return taskName(this.task); }

	title(multi_workspace: boolean)	{
		return multi_workspace && typeof(this.task.scope) === 'object' ? `${this.task.name} (${this.task.scope.name})` : this.task.name;
	}

	icontype()	{ return this.id.toLowerCase(); }
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
	constructor(public name: string, private workspace: vscode.WorkspaceFolder) { super(); }
	get id()	{ return `${this.workspace.name}.${this.name}`; }
	icontype()	{ return 'before'; }
	title(multi_workspace: boolean)	{
		return multi_workspace ? `${this.name} (${this.workspace.name})` : this.name;
	}
}
class TaskItemAfter extends TaskItemTaskBase {
	constructor(public name: string, private workspace: vscode.WorkspaceFolder) { super(); }
	get id()	{ return `${this.workspace.name}.${this.name}`; }
	icontype()	{ return 'after'; }
	title(multi_workspace: boolean)	{
		return multi_workspace ? `${this.name} (${this.workspace.name})` : this.name;
	}
}

class TaskItemLaunch extends TaskItem {
	constructor(private config: LaunchConfiguration, private workspace: vscode.WorkspaceFolder) { super(); }
	readonly type = 'launch';
	get id()	{ return `${this.workspace.name}.${this.config.name}`; }
	get order()	{ return this.config.presentation?.order;}

	colortype()	{ return this.config.type; }
	group()		{ return this.config.presentation?.group ?? ''; }

	title(multi_workspace: boolean)	{
		return multi_workspace ? `${this.config.name} (${this.workspace.name})` : this.config.name;
	}
	run() {
		vscode.debug.startDebugging(this.workspace, this.config);
	}
	edit() {
		//editConfig(this.name, 'launch', 'configurations', ['name']);
		editConfig1(this.workspace, this.config.name, 'launch', 'name');
	}
	hasChildren() { return !!(this.config.preLaunchTask || this.config.postDebugTask); }
	children()	{
		const children: TaskItem[] = [];
		if (this.config.preLaunchTask)
			children.push(new TaskItemBefore(this.config.preLaunchTask, this.workspace));
		if (this.config.postDebugTask)
			children.push(new TaskItemAfter(this.config.postDebugTask, this.workspace));
		return children;
	}
}

class TaskItemCompound extends TaskItem {
	constructor(private config: CompoundLaunchConfiguration, private workspace: vscode.WorkspaceFolder) { super(); }
	readonly type = 'compound';
	get id()	{ return `${this.workspace.name}.${this.config.name}`; }
	get order()	{ return this.config.presentation?.order;}
	
	colortype()	{ return 'compound'; }
	group()		{ return this.config.presentation?.group ?? ''; }

	title(multi_workspace: boolean)	{
		return multi_workspace ? `${this.config.name} (${this.workspace.name})` : this.config.name;
	}
	run() {
		vscode.debug.startDebugging(this.workspace, this.config.name);
	}
	edit() {
		//editConfig(this.name, 'launch', 'compounds', ['name']);
		editConfig1(this.workspace, this.config.name, 'launch', 'name');
	}
	hasChildren()	{ return true; }
	children()		{ return this.config.configurations.map(name => new TaskItemLaunch({type: 'compound', name, request:''}, this.workspace!)); }
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

	workspaces: {
		workspace:		vscode.WorkspaceFolder;
		launches:		LaunchConfiguration[];
		compounds: 		CompoundLaunchConfiguration[];
		taskConfigs:	TaskConfiguration[];
	}[]	= [];

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('taskviewer.stop',	(item: TaskItem) => {
				if (item.type === 'task')
					this.status[item.id]?.execution?.terminate();
				else if (item.type === 'launch') {
					console.log(`stop ${item.id}`);
					vscode.debug.stopDebugging(this.debugStatus[item.id].session);
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
		this.status[taskName(execution.task)] = {
			isActive: true,
			status: 'Running',
			execution
		};
	}

	stoppedTask(task: vscode.Task, exitCode?: number) {
		this.status[taskName(task)] = {
			isActive: false,
			status: exitCode === undefined ? 'Stopped' : (exitCode === 0 ? 'Success' : `Failed (${exitCode})`)
		};
	}
	startedDebug(session: vscode.DebugSession) {
		console.log(`started ${session.name}`);
		this.debugStatus[session.name] = {session};
	}
	stoppedDebug(session: vscode.DebugSession) {
		console.log(`stopped ${session.name}`);
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
		this.workspaces	= [];

		if (vscode.workspace.workspaceFolders) {
			for (const workspace of vscode.workspace.workspaceFolders) {
				const config = vscode.workspace.getConfiguration('launch', workspace.uri);

				const launches		= config.get<LaunchConfiguration[]>('configurations') ?? [];
				const compounds		= config.get<CompoundLaunchConfiguration[]>('compounds') ?? [];
				const config2		= vscode.workspace.getConfiguration('tasks', workspace.uri);
				const taskConfigs	= config2.get<TaskConfiguration[]>('tasks') ?? [];
				this.workspaces.push({workspace, launches, compounds, taskConfigs});
			}
		}
	}

}

//-----------------------------------------------------------------------------
// TaskTreeProvider
//-----------------------------------------------------------------------------

function makeTreeItem(item: TaskItem, icon_name: string, icon_color: string | undefined, multi_workspace: boolean) {
	const titem = new vscode.TreeItem(item.title(multi_workspace), item.hasChildren() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
	if (item.run)
		titem.command = {
			command: 'taskviewer.run',
			title: '',
			arguments: [item]
		};
	titem.iconPath	= new vscode.ThemeIcon(
		icon_name,
		icon_color ? new vscode.ThemeColor(icon_color) : undefined
	);
	return titem;
}

class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<TaskItem | undefined | null | void>();
	get onDidChangeTreeData() { return this._onDidChangeTreeData.event; }

	public showAll			= false;
	public groupByWorkspace = false;
	public multiRoot		= false;
	
	constructor(private shared: TasksShared, public showTasks: boolean, public showLaunches: boolean) {
	}

	refresh(item?: TaskItem) {
		this._onDidChangeTreeData.fire(item);
	}

	getTreeItem(item: TaskItem): vscode.TreeItem {
		switch (item.type) {
			default:
			case 'group': {
				const titem = new vscode.TreeItem(item.id, vscode.TreeItemCollapsibleState.Expanded);
				titem.iconPath = new vscode.ThemeIcon(this.shared.getIconName(item.icontype()));
				titem.contextValue = 'noedit';
				return titem;
			}
			case 'task': {
				const status = this.shared.getStatus(item.id);
				const icon	= status?.isActive ? 'sync~spin' : this.shared.getIconName(item.icontype());
				const color = status?.isActive ? undefined : this.shared.getColorFromType(item.colortype().toLowerCase());

				const titem = makeTreeItem(item, icon, color, this.multiRoot);

				titem.description	= status?.status;
				titem.contextValue	= status?.isActive ? 'running' : 'task';
				titem.tooltip = item.tooltip();
				return titem;
			}
			case 'launch': {
				const status = this.shared.isDebugging(item.id);
				const icon	= status ? 'sync~spin' : 'debug-alt';
				const titem = makeTreeItem(item, icon, this.shared.getColorFromType(item.colortype()), this.multiRoot);
				titem.contextValue	= status ? 'running' : 'launch';
				return titem;
			}

			case 'compound':
				return makeTreeItem(item, 'run-all', this.shared.getColorFromType(item.colortype()), this.multiRoot);
		}
	}

	async getChildren(item?: TaskItem): Promise<TaskItem[]> {
		if (!item) {
			//this.multiRoot = this.shared.workspaces.length > 1;
			const tasks:	Record<string, vscode.Task>	= this.showAll ? await TaskGetter.getTasks() : {};

			if (this.groupByWorkspace) {
				return this.shared.workspaces.map(ws => {
					const groups	= new GroupHelper;

					if (this.showTasks) {
						if (this.showAll) {
							ws.taskConfigs.forEach(i => {
								const item = new TaskItemTaskConfig(i, ws.workspace);
								delete tasks[item.id];
								groups.add(item);
							});

							const prefix = ws.workspace.name + '.';
							Object.keys(tasks).filter(k => k.startsWith(prefix)).forEach(k => groups.add(new TaskItemTask(tasks[k])));

						} else {
							ws.taskConfigs.forEach(i => groups.add(new TaskItemTaskConfig(i, ws.workspace)));
						}
					}

					if (this.showLaunches)
						ws.launches.forEach(i => groups.add(new TaskItemLaunch(i, ws.workspace)));

					return new TaskItemWorkspaceGroup(ws.workspace.name, groups.cleanup());

				});

			} else {
				const groups	= new GroupHelper;
				if (this.showTasks) {
					if (this.showAll) {
						this.shared.workspaces.forEach(ws => ws.taskConfigs.forEach(i => {
							const item = new TaskItemTaskConfig(i, ws.workspace);
							//const id = this.multiRoot ? ws.workspace.name + '.' + item.id : item.id;
							if (!tasks[item.id]) {
								console.log(`task ${item.id} not found`);
							}
							delete tasks[item.id];
							groups.add(item);
						}));

						Object.values(tasks).forEach(task => groups.add(new TaskItemTask(task)));

					} else {
						this.shared.workspaces.forEach(ws => ws.taskConfigs.forEach(i => groups.add(new TaskItemTaskConfig(i, ws.workspace))));
					}
				}

				if (this.showLaunches) {
					this.shared.workspaces.forEach(ws => ws.launches.forEach(i => groups.add(new TaskItemLaunch(i, ws.workspace))));
					this.shared.workspaces.forEach(ws => ws.compounds.forEach(i => groups.add(new TaskItemCompound(i, ws.workspace))));
				}

				return groups.cleanup();
			}

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

	const config		= vscode.workspace.getConfiguration('taskviewer');

	const setContext	= (name: 'showLaunches'|'showAll'|'groupByWorkspace'|'multiRoot', value: boolean) => {
		vscode.commands.executeCommand("setContext", "taskviewer." + name, taskTree[name] = value);
	};
	const setConfig		= (name: 'showLaunches'|'showAll'|'groupByWorkspace', value: boolean) => {
		setContext(name, value);
		taskTree.refresh();
		config.update(name, value);
	};

	setContext('showAll',		config.showAll);
	setContext('showLaunches',	config.showLaunches);
	setContext('groupByWorkspace',	config.groupByWorkspace);

	setContext('multiRoot',	(vscode.workspace.workspaceFolders?.length ?? 0) > 1);


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

		vscode.commands.registerCommand('taskviewer.showLaunches',	() => setConfig('showLaunches', true)),
		vscode.commands.registerCommand('taskviewer.hideLaunches',	() => setConfig('showLaunches', false)),

		vscode.commands.registerCommand('taskviewer.showAll',		() => setConfig('showAll', true)),
		vscode.commands.registerCommand('taskviewer.showConfig',	() => setConfig('showAll', false)),

		vscode.commands.registerCommand('taskviewer.groupByWorkspace',	() => setConfig('groupByWorkspace', true)),
		vscode.commands.registerCommand('taskviewer.ungroupByWorkspace',() => setConfig('groupByWorkspace', false)),

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

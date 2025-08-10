import * as vscode from 'vscode';
import {isDependant} from './dependants';
import {taskProvider, taskId, taskWorkspace} from './extension';

//-----------------------------------------------------------------------------
// Configurations
//-----------------------------------------------------------------------------

interface TaskConfiguration extends vscode.TaskDefinition {
	label?:			string;
	script?:		string;
	task?:			string;
	dependsOn?:		string | string[];
//	type:			string;
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

function editConfig(workspace: vscode.WorkspaceFolder|undefined, name: string, configuration: string, matchField: string) {
	const uri = workspace ? vscode.Uri.joinPath(workspace.uri, `.vscode/${configuration}.json`) : vscode.workspace.workspaceFile;
	if (uri) {
		vscode.workspace.openTextDocument(uri).then(document => {
			const match = (new RegExp(`"${matchField}":\\s*"${escapeRegex(name)}"`, 'g')).exec(document.getText());
			if (match) {
				const position = document.positionAt(match.index);
				vscode.window.showTextDocument(document, {selection: new vscode.Range(position, position)});
			}
		});
	}
}


//-----------------------------------------------------------------------------
// TasksShared
//-----------------------------------------------------------------------------

interface TaskStatus {
	exitCode?:	number;
	execution?:	vscode.TaskExecution;
}

interface LaunchStatus {
	session:	vscode.DebugSession;
}

function taskUri(taskId: string) {
	return vscode.Uri.from({scheme: 'taskviewer-task', path: '/' + taskId});
}
function launchUri(launchId: string) {
	return vscode.Uri.from({scheme: 'taskviewer-launch', path: '/' + launchId});
}

export class TasksShared implements vscode.FileDecorationProvider {
	private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<undefined | vscode.Uri | vscode.Uri[]>();
	private taskStatus: 	Record<string, TaskStatus> = {};
	private debugStatus:	Record<string, LaunchStatus> = {};
	private icons:			Record<string, string> = {};
	private colors:			Record<string, string> = {};

	workspaces: {
		workspace?:		vscode.WorkspaceFolder;
		launches:		LaunchConfiguration[];
		compounds: 		CompoundLaunchConfiguration[];
		taskConfigs:	TaskConfiguration[];
	}[]	= [];

	get	onDidChangeFileDecorations() { return this._onDidChangeFileDecorations.event; }

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.window.registerFileDecorationProvider(this),
			
			vscode.commands.registerCommand('taskviewer.stop',	(item: TaskItem) => {
				if (item.type === 'task') {
					this.taskStatus[item.id]?.execution?.terminate();
				} else if (item.type === 'launch') {
					console.log(`stop ${item.id}`);
					vscode.debug.stopDebugging(this.debugStatus[item.id].session);
				}
			}),
		);
	
		this.updateSettings();
		this.refresh();
	}

	provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken) {
		switch (uri.scheme) {
			case 'taskviewer-task': {
				const status = this.getTaskStatus(uri.path.slice(1));
				if (status)
					return {
						badge:	status.execution ? '▷' : status.exitCode ? '✗' : '✓',
						//tooltip: status.status
					};
				break;
			}
			case 'taskviewer-launch': {
				if (this.isDebugging(uri.path.slice(1)))
					return {
						badge:	'▷'
					};
				break;
			}
		}
	}

	getIconName(name: string) {
		for (const [key, value] of Object.entries(this.icons)) {
			if (name.includes(key))
				return value;
		}
		return this.icons.default;
	}
	
	getColor(type: string): string {
		return this.colors[type] ?? this.colors.default;
	}
		
	startedTask(taskId: string, execution: vscode.TaskExecution) {
		this._onDidChangeFileDecorations.fire(taskUri(taskId));
		this.taskStatus[taskId] = {
			execution
		};
	}

	stoppedTask(taskId: string, exitCode?: number) {
		this._onDidChangeFileDecorations.fire(taskUri(taskId));
		this.taskStatus[taskId] = {
			exitCode
		};
	}
	startedDebug(session: vscode.DebugSession) {
		this._onDidChangeFileDecorations.fire(launchUri(session.name));
		console.log(`started ${session.name}`);
		this.debugStatus[session.name] = {session};
	}
	stoppedDebug(session: vscode.DebugSession) {
		this._onDidChangeFileDecorations.fire(launchUri(session.name));
		console.log(`stopped ${session.name}`);
		delete this.debugStatus[session.name];
	}

	getTaskStatus(name: string) : TaskStatus | undefined {
		return this.taskStatus[name];
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
		this.taskStatus	= {};
		this.workspaces	= [];

		taskProvider.refresh();

		const getWorkspace = (workspace?: vscode.WorkspaceFolder) => {
			const config		= vscode.workspace.getConfiguration('launch', workspace?.uri);
			const launches		= config.get<LaunchConfiguration[]>('configurations') ?? [];
			const compounds		= config.get<CompoundLaunchConfiguration[]>('compounds') ?? [];

			const config2		= vscode.workspace.getConfiguration('tasks', workspace?.uri);
			const taskConfigs	= config2.get<TaskConfiguration[]>('tasks') ?? [];
			return {workspace, launches, compounds, taskConfigs};
		};

		if (vscode.workspace.workspaceFolders) {
			for (const workspace of vscode.workspace.workspaceFolders)
				this.workspaces.push(getWorkspace(workspace));
		}

		if (vscode.workspace.workspaceFile)
			this.workspaces.push(getWorkspace());
	}

}

//-----------------------------------------------------------------------------
// TaskItem
//-----------------------------------------------------------------------------

function itemTitle(multi_workspace: boolean, name: string, ws?: vscode.WorkspaceFolder)	{
	return multi_workspace && ws ? `${name} (${ws.name})` : name;
}

function itemId(name: string, ws?: vscode.WorkspaceFolder) {
	return ws ? ws.name + '.' + name : name;
}

function configName(config: TaskConfiguration) {
	return config.label ?? config.script ?? config.task ?? '';
}

function configId(config: TaskConfiguration, ws?: vscode.WorkspaceFolder) {
	return itemId(configName(config), ws);
}

export abstract class TaskItem {
	abstract type:	string;
	abstract id:	string;
	get icontype()	{ return this.type; }
	get colortype()	{ return ''; }
	get group()		{ return ''; }
	get order(): number | undefined { return undefined; }

	title(_multi_workspace: boolean):	string	{ return this.id; }
	tooltip(): 		vscode.MarkdownString | undefined { return undefined; }
	run?():			void;
	canEdit()		{ return false; }	
	edit()			{}
	hasChildren() 	{ return false; }
	children(_tree?: TaskTreeProvider): TaskItem[]	{ return []; }
}

class TaskItemGroup extends TaskItem {
	constructor(public id: string, private entries: TaskItem[]) { super(); }
	readonly type = 'group';
	get icontype()	{ return this.id; }
	hasChildren()	{ return true; }
	children()		{ return this.entries; }
}

class TaskItemWorkspaceGroup extends TaskItemGroup {
	get icontype() { return 'workspace'; }
}

class GroupHelper {
	groups:	Record<string, TaskItem[]>	= {};
	add(item: TaskItem) {
		(this.groups[item.group] ??= []).push(item);
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

	populate(configs: TaskConfiguration[], tasks: Record<string, vscode.Task>, ws?: vscode.WorkspaceFolder) {
		configs.forEach(i => {
			const id	= configId(i, ws);
			const task	= tasks[id];
			if (task) {
				delete tasks[id];
				this.add(new TaskItemTask(task));
			} else {
				this.add(new TaskItemTaskConfig(i, ws));
			}
			//const item = new TaskItemTaskConfig(i, ws.workspace);
			//delete tasks[item.id];
			//groups.add(item);
		});

	}
}

//-----------------------------------------------------------------------------
// Task TaskItems
//-----------------------------------------------------------------------------

abstract class TaskItemTaskBase extends TaskItem {
	readonly type = 'task';
	abstract workspace?:	vscode.WorkspaceFolder;
	abstract name:			string;

	run()		{
		taskProvider.getTasksAsync().then(tasks => {
			const task = tasks.byId[this.id];
			if (task)
				vscode.tasks.executeTask(task);
		});
	}
	canEdit()	{ return true; }
	edit()		{ editConfig(this.workspace, this.name, 'tasks', '(?:label|task|script)'); }
}

//task item from tasks.json

class TaskItemTaskConfig extends TaskItemTaskBase {
	constructor(private config: TaskConfiguration, public workspace?: vscode.WorkspaceFolder) {
		super();
	}

	get name()		{ return configName(this.config); }
	get id()		{ return configId(this.config, this.workspace); }
	get icontype()	{ return this.id.toLowerCase(); }
	get colortype()	{ return this.config.type ?? 'compound'; }
	get group()		{ return (typeof this.config.group === 'string' ? this.config.group : this.config.group?.kind) ?? ''; }

	title(multi_workspace: boolean)	{
		return itemTitle(multi_workspace, this.name, this.workspace);
	}

	tooltip() {
		const tooltip = new vscode.MarkdownString('', true);
		tooltip.isTrusted	= true;
		tooltip.supportHtml = true;
		tooltip.appendMarkdown(`**Type:** ${this.config.type}\n\n`);
		if (this.config.detail)
			tooltip.appendMarkdown(`**Detail:** ${this.config.detail}\n\n`);
		return tooltip;
	}
	hasChildren() {
		return !!this.config.dependsOn
			|| (isDependant(this.config) && !!(this.config.inputs?.length || this.config.outputs?.length));
	}
	children(tree: TaskTreeProvider)	{
		const children: TaskItem[] = [];
		if (this.config.dependsOn) {
			if (Array.isArray(this.config.dependsOn))
				children.push(...this.config.dependsOn.map(name => new TaskItemBefore(name, this.workspace)));
			else
				children.push(new TaskItemBefore(this.config.dependsOn, this.workspace));
		}

		if (isDependant(this.config)) {
			if (this.config.inputs)
				children.push(...this.config.inputs.map(input => new TaskItemInput(tree, input)));
			if (this.config.outputs)
				children.push(...this.config.outputs.map(output => new TaskItemOutput(output)));
		}

		return children;
	}
}

//task item from fetchTasks

class TaskItemTask extends TaskItemTaskBase {
	constructor(private task: vscode.Task) { super(); }
	get name()		{ return this.task.name; }
	get id()		{ return taskId(this.task); }
	get icontype()	{ return this.id.toLowerCase(); }
	get colortype()	{ return this.task.definition.type; }
	get group()		{ return this.task.group?.id ?? this.task.source ?? ''; }

	get workspace() {
		return typeof(this.task.scope) === 'object' ? this.task.scope : undefined;
	}
	title(multi_workspace: boolean)	{
		return itemTitle(multi_workspace, this.task.name, this.workspace);
	}
	canEdit()	{ return this.task.source === 'Workspace'; }
	run()		{ vscode.tasks.executeTask(this.task); }

	tooltip() {
		const tooltip = new vscode.MarkdownString('', true);
		tooltip.isTrusted	= true;
		tooltip.supportHtml = true;
		tooltip.appendMarkdown(`**Type:** ${this.task.definition.type}\n\n`);
		if (this.task.detail)
			tooltip.appendMarkdown(`**Detail:** ${this.task.detail}\n\n`);
		return tooltip;
	}
}

class TaskItemBefore extends TaskItemTaskBase {
	constructor(public name: string, public workspace?: vscode.WorkspaceFolder) { super(); }
	get id()			{ return itemId(this.name, this.workspace); }
	get icontype()		{ return 'before'; }
	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.name, this.workspace); }
}
class TaskItemAfter extends TaskItemTaskBase {
	constructor(public name: string, public workspace?: vscode.WorkspaceFolder) { super(); }
	get id()			{ return itemId(this.name, this.workspace); }
	get icontype()		{ return 'after'; }
	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.name, this.workspace); }
}

class TaskItemInput extends TaskItemTaskBase {
	task?: vscode.Task | null;
	constructor(tree: TaskTreeProvider, public name: string) {
		super();
		taskProvider.getTasksAsync().then(() => {
			this.task = taskProvider.getBuilder(name) ?? null;
			tree.refresh(this);
		});
	}
	get workspace()		{ return undefined; }
	get id()			{ return this.name; }
	get icontype()		{ return 'input'; }
	get colortype()		{ return 'input'; }

	title(_multi_workspace: boolean)	{
		return this.task === null ? this.name : `${this.name} (${this.task?.name ?? 'searching...'})`;
	}
	run()		{
		taskProvider.getTasksAsync().then(() =>
			taskProvider.getDepends([this.name]).forEach(task => vscode.tasks.executeTask(task))
		);
	}
	canEdit(): boolean {
		return !!this.task;
	}
	edit()		{
		if (this.task)
			editConfig(taskWorkspace(this.task), this.task.name, 'tasks', 'label');
	}
}

class TaskItemOutput extends TaskItemTaskBase {
	constructor(public name: string) { super(); }
	get workspace()		{ return undefined; }
	get id()			{ return this.name; }
	get icontype()		{ return 'output'; }
	get colortype()		{ return 'output'; }
	canEdit()			{ return false; }
	title(_multi_workspace: boolean)	{ return this.name; }
}

//-----------------------------------------------------------------------------
// Debug TaskItems
//-----------------------------------------------------------------------------

class TaskItemLaunch extends TaskItem {
	readonly type = 'launch';
	constructor(private config: LaunchConfiguration, private workspace?: vscode.WorkspaceFolder) { super(); }

	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.config.name, this.workspace); }

	get id()		{ return itemId(this.config.name, this.workspace); }
	get order()		{ return this.config.presentation?.order;}
	get icontype()	{ return this.type; }
	get colortype()	{ return this.config.type; }
	get group()		{ return this.config.presentation?.group ?? ''; }

	canEdit()		{ return true; }
	edit() 			{ editConfig(this.workspace, configName(this.config), 'launch', 'name'); }
	run() 			{ vscode.debug.startDebugging(this.workspace, this.config); }
	hasChildren()	{ return !!(this.config.preLaunchTask || this.config.postDebugTask); }
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
	readonly type = 'compound';
	constructor(private config: CompoundLaunchConfiguration, private workspace?: vscode.WorkspaceFolder) { super(); }

	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.config.name, this.workspace); }

	get id()		{ return itemId(this.config.name, this.workspace); }
	get order()		{ return this.config.presentation?.order;}
	get icontype()	{ return this.type; }
	get colortype()	{ return 'compound'; }
	get group()		{ return this.config.presentation?.group ?? ''; }

	canEdit()		{ return true; }
	edit()			{ editConfig(this.workspace, this.config.name, 'launch', 'name'); }
	run()			{ vscode.debug.startDebugging(this.workspace, this.config.name); }
	hasChildren()	{ return true; }
	children()		{ return this.config.configurations.map(name => new TaskItemLaunch({type: 'compound', name, request:''}, this.workspace!)); }
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

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskItem> {
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
				const titem			= new vscode.TreeItem(item.id, vscode.TreeItemCollapsibleState.Expanded);
				titem.iconPath		= new vscode.ThemeIcon(this.shared.getIconName(item.icontype));
				titem.contextValue	= 'noedit';
				return titem;
			}
			case 'task': {
				const status		= this.shared.getTaskStatus(item.id);
				const active		= !!status?.execution;
				const icon			= active ? 'sync~spin' : this.shared.getIconName(item.icontype);
				const color 		= active ? undefined : this.shared.getColor(item.colortype.toLowerCase());

				const titem			= makeTreeItem(item, icon, color, this.multiRoot);
				titem.contextValue	= active ? 'running' : item.canEdit() ? 'task' : 'noedit';
				//titem.description	= active ? 'running' : status ? (status.exitCode === undefined ? 'Stopped' : status.exitCode === 0 ? 'Success' : `Failed (${status.exitCode})`) : undefined;
				titem.tooltip		= item.tooltip();
				titem.resourceUri	= taskUri(item.id);
				return titem;
			}
			case 'launch': {
				const status		= this.shared.isDebugging(item.id);
				const icon			= status ? 'sync~spin' : 'debug-alt';
				const titem			= makeTreeItem(item, icon, this.shared.getColor(item.colortype), this.multiRoot);
				titem.contextValue	= status ? 'running' : 'launch';
				titem.resourceUri	= launchUri(item.id);
				return titem;
			}

			case 'compound':
				return makeTreeItem(item, 'run-all', this.shared.getColor(item.colortype), this.multiRoot);
		}
	}

	async getChildren(item?: TaskItem): Promise<TaskItem[]> {
		if (!item) {
			const tasks:	Record<string, vscode.Task>	= this.showAll ? (await taskProvider.getTasksAsync()).byId : {};

			if (this.groupByWorkspace) {
				return this.shared.workspaces.map(ws => {
					const groups	= new GroupHelper;

					if (this.showTasks) {
						if (this.showAll) {
							groups.populate(ws.taskConfigs, tasks, ws.workspace);

							if (ws.workspace) {
								const prefix	= ws.workspace.name + '.';
								const wstasks	= Object.keys(tasks).filter(k => k.startsWith(prefix));
								wstasks.forEach(k => groups.add(new TaskItemTask(tasks[k])));
								wstasks.forEach(k => delete tasks[k]);
							} else {
								Object.values(tasks).forEach(task => groups.add(new TaskItemTask(task)));
							}

						} else {
							ws.taskConfigs.forEach(i => groups.add(new TaskItemTaskConfig(i, ws.workspace!)));
						}
					}

					if (this.showLaunches) {
						ws.launches.forEach(i => groups.add(new TaskItemLaunch(i, ws.workspace)));
						ws.compounds.forEach(i => groups.add(new TaskItemCompound(i, ws.workspace)));
					}

					return new TaskItemWorkspaceGroup(ws.workspace?.name ?? 'workspace', groups.cleanup());

				});

			} else {
				const groups	= new GroupHelper;
				if (this.showTasks) {
					if (this.showAll) {
						this.shared.workspaces.forEach(ws => groups.populate(ws.taskConfigs, tasks, ws.workspace));
						Object.values(tasks).forEach(task => groups.add(new TaskItemTask(task)));
					} else {
						this.shared.workspaces.forEach(ws => ws.taskConfigs.forEach(i => groups.add(new TaskItemTaskConfig(i, ws.workspace))));
					}
				}

				if (this.showLaunches) {
					this.shared.workspaces.forEach(ws => ws.launches.forEach(i => groups.add(new TaskItemLaunch(i, ws.workspace!))));
					this.shared.workspaces.forEach(ws => ws.compounds.forEach(i => groups.add(new TaskItemCompound(i, ws.workspace!))));
				}

				return groups.cleanup();
			}

		}
		return item.children(this);
	}
}

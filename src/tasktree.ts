import * as vscode from 'vscode';

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

function escapeRegex(str: string) {
	return str.replaceAll('\\', '\\\\') // Double \
		.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escapes all special chars
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
// Extensions
//-----------------------------------------------------------------------------

export interface CustomItem {
	title:		string;
	group?:		string;
	icon?:		vscode.ThemeIcon;
	tooltip?:	vscode.MarkdownString;
	run?():		void;
	edit?():	void;
	children?(): Promise<CustomItem[]>;
}

export interface TypeHandler {
	makeItem(id: string, task: vscode.Task|undefined, def: vscode.TaskDefinition, workspace?: vscode.WorkspaceFolder): CustomItem | void;
}

export interface TaskProvider {
	provideItems(): Promise<CustomItem[]>;
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
	private types:			Record<string, TypeHandler> = {};
	private providers:		TaskProvider[] = [];

	asyncTasks?:	Thenable<Record<string, vscode.Task>>;
	asyncProvided?:	Thenable<CustomItem[]>;
	timeout?:		NodeJS.Timeout;

	workspaces: {
		workspace?:		vscode.WorkspaceFolder;
		launches:		LaunchConfiguration[];
		compounds: 		CompoundLaunchConfiguration[];
		taskConfigs:	TaskConfiguration[];
	}[]	= [];
	
	multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;

	get	onDidChangeFileDecorations() { return this._onDidChangeFileDecorations.event; }

	constructor() {
		this.updateSettings();
		this.refresh();
	}

	async getTasks(refresh = false) {
		if (!this.asyncTasks || (refresh && !this.timeout)) {
			this.asyncTasks = vscode.tasks.fetchTasks().then(tasks => {
				this.timeout = setTimeout(() => this.timeout = undefined, 5000);
				return Object.fromEntries(tasks.map(task => [taskId(task), task]));
			});
			this.asyncProvided = Promise.all(this.providers.map(p => p.provideItems())).then(items => items.flat());
		}
		return await this.asyncTasks!;
	}

	async getTaskById(id: string) {
		return (await this.getTasks())[id];
	}

	async getProvided() {
		return await this.asyncProvided;
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

	stop(item: Item)  {
		if (item.type === 'task') {
			this.taskStatus[item.id]?.execution?.terminate();
		} else if (item.type === 'launch') {
			console.log(`stop ${item.id}`);
			vscode.debug.stopDebugging(this.debugStatus[item.id].session);
		}
	}

	updateSettings() {
		const config	= vscode.workspace.getConfiguration('taskviewer');
		this.icons		= config.icons;
		this.colors		= config.colors;
	}

	refresh() {
		clearTimeout(this.timeout);
		this.asyncTasks = undefined;

		this.taskStatus	= {};
		this.workspaces	= [];

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

	registerType(type: string, handler: TypeHandler) {
		this.types[type] = handler;
	}
	registerProvider(handler: TaskProvider) {
		this.providers.push(handler);
	}
	makeTaskItem(task: vscode.Task) : Item {
		const handler = this.types[task?.definition.type];
		if (handler) {
			const workspace = typeof task.scope === 'object' ? task.scope : undefined;
			const id		= itemId(task.name, workspace);
			const custom	= handler.makeItem(id, task, task.definition, workspace);
			if (custom)
				return new CustomItemWrapper({group: task?.definition.type, ...custom}, id, workspace);
		}
		return new TaskItemTask(task);
	}
	makeItem(task: vscode.Task|undefined, config: TaskConfiguration, workspace?: vscode.WorkspaceFolder) : Item {
		const handler = this.types[config.type];
		if (handler) {
			const id = itemId(task?.name ?? configName(config), workspace);
			const custom = handler.makeItem(id, task, config, workspace);
			if (custom)
				return new CustomItemWrapper({group: config.type, ...custom}, id, workspace);
		}
		return task ? new TaskItemTask(task) : new TaskItemConfig(this, config, workspace);
	}

	editConfig(workspace: vscode.WorkspaceFolder|undefined, name: string, configuration: string, matchField: string) {
		editConfig(workspace, name, configuration, matchField);
	}
}

//-----------------------------------------------------------------------------
// TaskItem
//-----------------------------------------------------------------------------

export function itemId(name: string, ws?: vscode.WorkspaceFolder) {
	return ws ? ws.name + '.' + name : name;
}

export function taskId(task: vscode.Task) {
	return itemId(task.name, typeof task.scope === 'object' ? task.scope : undefined);
}

function makeIcon(name: string, color?: string): vscode.ThemeIcon {
	return new vscode.ThemeIcon(name, color ? new vscode.ThemeColor(color) : undefined);
}

function itemTitle(multi_workspace: boolean, name: string, ws?: vscode.WorkspaceFolder)	{
	return multi_workspace && ws ? `${name} (${ws.name})` : name;
}

function configName(config: TaskConfiguration) {
	return config.label ?? config.script ?? config.task ?? config.command ?? '';
//	return config.label ?? `${config.type}: ${config.script ?? config.task ?? config.command}`;
}

export abstract class Item {
	abstract type:	string;
	abstract id:	string;
	get group()		{ return ''; }
	get order(): number | undefined { return undefined; }

	run()			{}
	canEdit()		{ return false; }	
	edit()			{}
	children(_tree?: TaskTreeProvider): Item[]|Promise<Item[]>	{ return []; }

	abstract makeTreeItem(shared: TasksShared): vscode.TreeItem;
}

class GroupItem extends Item {
	constructor(public id: string, public entries: Item[]) { super(); 
	}
	readonly type = 'group';
	get icontype()	{ return this.id; }
	children()		{ return this.entries; }

	sort() {
		const get_order = (item: Item) => item.order ?? 10000;
		this.entries.sort((a, b) => get_order(a) - get_order(b));
	}

	makeTreeItem(shared: TasksShared) {
		const titem			= new vscode.TreeItem(this.id, vscode.TreeItemCollapsibleState.Expanded);
		titem.iconPath		= new vscode.ThemeIcon(shared.getIconName(this.icontype));
		titem.contextValue	= 'group';
		return titem;
	}
}

class WorkspaceGroupItem extends GroupItem {
	get icontype() { return 'workspace'; }
	makeTreeItem(shared: TasksShared) {
		const titem			= new vscode.TreeItem(this.id, vscode.TreeItemCollapsibleState.Collapsed);
		titem.iconPath		= new vscode.ThemeIcon(shared.getIconName(this.icontype));
		titem.contextValue	= 'group';
		return titem;
	}
}

function makeGroup(id: string) {
	const match = id.match(/^\d+_(.*)/);
	return new GroupItem(match ? match[1] : id, []);
}

class GroupHelper extends Array<Item> {
	groups:	Record<string, GroupItem>	= {};

	add(item: Item) {
		const i = item.group || item.type;
		(this.groups[i] ??= makeGroup(i)).entries.push(item);
	}
	addPost(item: Item, tree: TaskTreeProvider, parent?: Item) {
		const i = item.group || item.type;
		if (!this.groups[i]) {
			this.groups[i] = new GroupItem(i, [item]);
			this.makeArray();
			tree.update(parent);
		} else {
			const group = this.groups[i];
			group.entries.push(item);
			group.sort();
			tree.update(group);
		}
	}
	cleanup() {
		Object.values(this.groups).forEach(group => group.sort());
		this.makeArray();
		return this;
	}
	makeArray() {
		this.length = 0;
		this.push(...Object.values(this.groups));
		this.sort((a, b) => a.id > b.id ? 1 : -1);
	}
/*
	populate(shared: TasksShared, configs: TaskConfiguration[], tasks: Record<string, vscode.Task>, ws?: vscode.WorkspaceFolder) {
		configs.forEach(i => {
			const id	= itemId(configName(i), ws);
			delete tasks[id];
			this.add(shared.makeItem(tasks[id], i, ws));
			//const item = new TaskItemTaskConfig(i, ws.workspace);
			//delete tasks[item.id];
			//groups.add(item);
		});

	}
*/
}

//-----------------------------------------------------------------------------
// Task TaskItems
//-----------------------------------------------------------------------------

abstract class TaskItem extends Item {
	readonly type = 'task';
	abstract workspace?:	vscode.WorkspaceFolder;
	abstract name:			string;
	abstract icontype:		string;
	get colortype()	{ return ''; }
	get id()		{ return itemId(this.name, this.workspace); }

	canEdit()	{ return true; }
	edit()		{ editConfig(this.workspace, this.name, 'tasks', '(?:label|task|script|command)'); }

	title(multi_workspace: boolean)	{
		return itemTitle(multi_workspace, this.name, this.workspace);
	}

	tooltip(): 		vscode.MarkdownString | undefined { return undefined; }
	hasChildren() { return false; }

	makeTreeItem(shared: TasksShared) {
		const status		= shared.getTaskStatus(this.id);
		const active		= !!status?.execution;
		const icon			= active ? 'sync~spin' : shared.getIconName(this.icontype);
		const color 		= active ? undefined : shared.getColor(this.colortype.toLowerCase());

		const titem			= makeTreeItem(this, this.title(shared.multiRoot), this.hasChildren(), true, makeIcon(icon, color));
		titem.contextValue	= active ? 'running' : this.canEdit() ? 'task' : 'noedit';
		//titem.description	= active ? 'running' : status ? (status.exitCode === undefined ? 'Stopped' : status.exitCode === 0 ? 'Success' : `Failed (${status.exitCode})`) : undefined;
		titem.tooltip		= this.tooltip();
		titem.resourceUri	= taskUri(this.id);
		return titem;
	}
}

//task item from tasks.json

abstract class TaskItemWithId extends TaskItem {
	constructor(public shared: TasksShared, public workspace?: vscode.WorkspaceFolder) {
		super();
	}

	async run()		{
		const task = await this.shared.getTaskById(this.id);
		if (task)
			vscode.tasks.executeTask(task);
	}
}

class TaskItemConfig extends TaskItemWithId {
	constructor(shared: TasksShared, private config: TaskConfiguration, workspace?: vscode.WorkspaceFolder) {
		super(shared, workspace);
	}

	get name()		{ return configName(this.config); }
	get icontype()	{ return this.id.toLowerCase(); }
	get colortype()	{ return this.config.type ?? 'compound'; }
	get group()		{ return (typeof this.config.group === 'string' ? this.config.group : this.config.group?.kind) ?? ''; }

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
		return !!this.config.dependsOn;
	}
	children(_tree: TaskTreeProvider)	{
		return Array.isArray(this.config.dependsOn)
			? this.config.dependsOn.map(name => new TaskItemBefore(this.shared, name, this.workspace))
			: [new TaskItemBefore(this.shared, this.config.dependsOn!, this.workspace)];
	}
}

class TaskItemBefore extends TaskItemWithId {
	constructor(shared: TasksShared, public name: string, workspace?: vscode.WorkspaceFolder) { super(shared, workspace); }
	get icontype()		{ return 'before'; }
}

class TaskItemAfter extends TaskItemWithId {
	constructor(shared: TasksShared, public name: string, workspace?: vscode.WorkspaceFolder) { super(shared, workspace); }
	get icontype()		{ return 'after'; }
}

//task item from fetchTasks

class TaskItemTask extends TaskItem {
	constructor(private task: vscode.Task) {
		super();
	}

	get name()		{ return this.task.name; }
	get icontype()	{ return this.id.toLowerCase(); }
	get colortype()	{ return this.task.definition.type; }
	get group()		{ return this.task.group?.id ?? this.task.source ?? ''; }
	get workspace() { return typeof(this.task.scope) === 'object' ? this.task.scope : undefined; }

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


class CustomItemWrapper extends Item {
	readonly type = 'task';
	constructor(private item: CustomItem, public id: string, private workspace?: vscode.WorkspaceFolder) {
		super();
	}
	get group()			{ return this.item.group ?? ''; }

	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.item.title, this.workspace); }
	tooltip()			{ return this.item.tooltip; }
	run()				{ this.item.run?.(); }
	edit()				{ this.item.edit?.(); }
	hasChildren()		{ return !!this.item.children; }
	async children()	{ return (await this.item.children!()).map(i => new CustomItemWrapper(i, 'id', this.workspace)) ?? []; }

	makeTreeItem(shared: TasksShared) {
		const status		= shared.getTaskStatus(this.id);
		const active		= !!status?.execution;
		const icon			= active ? new vscode.ThemeIcon('sync~spin') : this.item.icon ?? new vscode.ThemeIcon(shared.getIconName('default'));
		const titem			= makeTreeItem(this, this.title(shared.multiRoot), this.hasChildren(), !!this.item.run, icon);
		titem.contextValue	= active ? 'running' : this.item.edit ? 'task' : 'noedit';
		titem.tooltip		= this.tooltip();
		titem.resourceUri	= taskUri(this.id);
		return titem;
	}
}

//-----------------------------------------------------------------------------
// Debug TaskItems
//-----------------------------------------------------------------------------

class LaunchItem extends Item {
	readonly type = 'launch';
	constructor(private config: LaunchConfiguration, private workspace?: vscode.WorkspaceFolder) { super(); }

	get id()		{ return itemId(this.config.name, this.workspace); }
	get order()		{ return this.config.presentation?.order;}
	get group()		{ return this.config.presentation?.group ?? ''; }

	edit() 			{ editConfig(this.workspace, this.config.name, 'launch', 'name'); }
	run() 			{ vscode.debug.startDebugging(this.workspace, this.config); }

	children(tree: TaskTreeProvider)	{
		const children: Item[] = [];
		if (this.config.preLaunchTask)
			children.push(new TaskItemBefore(tree.shared, this.config.preLaunchTask, this.workspace));
		if (this.config.postDebugTask)
			children.push(new TaskItemAfter(tree.shared, this.config.postDebugTask, this.workspace));
		return children;
	}

	makeTreeItem(shared: TasksShared): vscode.TreeItem {
		const status		= shared.isDebugging(this.id);
		const title			= itemTitle(shared.multiRoot, this.config.name, this.workspace);
		const hasChildren	= !!(this.config.preLaunchTask || this.config.postDebugTask);
		const titem			= makeTreeItem(this, title, hasChildren, true, makeIcon(status ? 'sync~spin' : 'debug-alt', shared.getColor(this.config.type)));
		titem.contextValue	= status ? 'running' : 'launch';
		titem.resourceUri	= launchUri(this.id);
		return titem;
	}

}

class CompoundItem extends Item {
	readonly type = 'compound';
	constructor(private config: CompoundLaunchConfiguration, private workspace?: vscode.WorkspaceFolder) { super(); }

	title(multi_workspace: boolean)	{ return itemTitle(multi_workspace, this.config.name, this.workspace); }

	get id()		{ return itemId(this.config.name, this.workspace); }
	get order()		{ return this.config.presentation?.order;}
	get group()		{ return this.config.presentation?.group ?? ''; }

	edit()			{ editConfig(this.workspace, this.config.name, 'launch', 'name'); }
	run()			{ vscode.debug.startDebugging(this.workspace, this.config.name); }
	children()		{ return this.config.configurations.map(name => new LaunchItem({type: 'compound', name, request:''}, this.workspace!)); }

	makeTreeItem(shared: TasksShared): vscode.TreeItem {
		return makeTreeItem(this, this.title(shared.multiRoot), true, true, makeIcon('run-all', shared.getColor('compound')));
	}
}

//-----------------------------------------------------------------------------
// TaskTreeProvider
//-----------------------------------------------------------------------------

function makeTreeItem(item: Item, title: string, hasChildren: boolean, canRun: boolean, iconPath: vscode.ThemeIcon) {
	const titem = new vscode.TreeItem(
		title,
		hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
	);
	if (canRun)
		titem.command = {
			command:	'taskviewer.run',
			title:		'Run Task',
			arguments:	[item]
		};
	titem.iconPath	= iconPath;
	return titem;
}

export class TaskTreeProvider implements vscode.TreeDataProvider<Item> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<Item | undefined | null | void>();
	get onDidChangeTreeData() { return this._onDidChangeTreeData.event; }

	public showAll			= false;
	public groupByWorkspace = false;
	public multiRoot		= false;
	private root?: Item[];
	
	constructor(public shared: TasksShared, public showTasks: boolean, public showLaunches: boolean) {
	}

	update(item?: Item) {
		this._onDidChangeTreeData.fire(item);
	}

	refresh() {
		this.root = undefined;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(item: Item): vscode.TreeItem {
		return item.makeTreeItem(this.shared);
	}

	async getChildren(item?: Item): Promise<Item[]> {
		if (item)
			return item.children(this);
		return this.root ??= await this.makeRoot();
	}

	async makeRoot() {
		const provided = await this.shared.getProvided();

		if (this.groupByWorkspace) {
			return this.shared.workspaces.map(ws => {
				const groups	= new GroupHelper;
				const branch	= new WorkspaceGroupItem(ws.workspace?.name ?? 'workspace', []);

				if (this.showTasks) {
					ws.taskConfigs.forEach(i => groups.add(this.shared.makeItem(undefined, i, ws.workspace!)));

					if (this.showAll) {
						this.shared.getTasks().then(tasks => {
							const extra = ws.workspace
								? Object.values(tasks).filter(task => task.source !== 'Workspace' && task.scope === ws.workspace)
								: Object.values(tasks).filter(task => task.source !== 'Workspace' && typeof task.scope !== 'object');
							extra.forEach(task => groups.addPost(this.shared.makeTaskItem(task), this, branch));
						});
					}

				}

				if (this.showLaunches) {
					ws.launches.forEach(i => groups.add(new LaunchItem(i, ws.workspace)));
					ws.compounds.forEach(i => groups.add(new CompoundItem(i, ws.workspace)));
				}

				branch.entries = groups.cleanup();
				return branch;
			});

		} else {
			const groups = new GroupHelper;
			if (this.showTasks) {
				this.shared.workspaces.forEach(ws => ws.taskConfigs.forEach(i => groups.add(this.shared.makeItem(undefined, i, ws.workspace))));

				if (this.showAll) {
					this.shared.getTasks().then(tasks => {
						const extra = Object.values(tasks).filter(task => task.source !== 'Workspace');
						extra.forEach(task => groups.addPost(this.shared.makeTaskItem(task), this));
					});
				}

				provided?.forEach(item => groups.add(new CustomItemWrapper(item, `provided.${item.title}`, undefined)));
			}

			if (this.showLaunches) {
				this.shared.workspaces.forEach(ws => ws.launches.forEach(i => groups.add(new LaunchItem(i, ws.workspace!))));
				this.shared.workspaces.forEach(ws => ws.compounds.forEach(i => groups.add(new CompoundItem(i, ws.workspace!))));
			}


			return groups.cleanup();
		}
	}
}

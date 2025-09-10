import * as vscode from 'vscode';
import { TasksShared, TaskTreeProvider, Item } from './tasktree';
export { CustomItem } from './tasktree';

//-----------------------------------------------------------------------------
// entry
//-----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
	const shared		= new TasksShared(context);
	const taskTree		= new TaskTreeProvider(shared, true, false);
	const launchTree	= new TaskTreeProvider(shared, false, true);

	const config		= vscode.workspace.getConfiguration('taskviewer');

	const setContext	= (name: 'showLaunches'|'showAll'|'groupByWorkspace', value: boolean) => {
		vscode.commands.executeCommand("setContext", "taskviewer." + name, taskTree[name] = value);
	};
	const setConfig		= (name: 'showLaunches'|'showAll'|'groupByWorkspace', value: boolean) => {
		setContext(name, value);
		taskTree.refresh();
		config.update(name, value);
	};

	const setLaunchContext	= (name: 'groupByWorkspace', value: boolean) => {
		vscode.commands.executeCommand("setContext", "launchviewer." + name, launchTree[name] = value);
	};
	const setLaunchConfig	= (name: 'groupByWorkspace', value: boolean) => {
		setLaunchContext(name, value);
		launchTree.refresh();
		config.update('launch.' + name, value);
	};

	vscode.commands.executeCommand("setContext", 'taskviewer.multiroot', shared.multiRoot);

	setContext('showAll',			config.showAll);
	setContext('showLaunches',		config.showLaunches);
	setContext('groupByWorkspace',	config.groupByWorkspace);
	setLaunchContext('groupByWorkspace',	config.launch.groupByWorkspace);

	context.subscriptions.push(
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
export type exports = ReturnType<typeof activate>;

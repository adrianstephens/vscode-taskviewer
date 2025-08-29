import * as vscode from 'vscode';
import { TasksShared, TaskTreeProvider, Item, taskId } from './tasktree';
export { CustomItem } from './tasktree';

//-----------------------------------------------------------------------------
// entry
//-----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
	const shared		= new TasksShared();
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

	setContext('showAll',			config.showAll);
	setContext('showLaunches',		config.showLaunches);
	setContext('groupByWorkspace',	config.groupByWorkspace);

	setContext('multiRoot',	(vscode.workspace.workspaceFolders?.length ?? 0) > 1);

	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('taskviewer.view', taskTree),
		vscode.window.registerTreeDataProvider('taskviewer.launchView', launchTree),
		vscode.window.registerFileDecorationProvider(shared),

		vscode.commands.registerCommand('taskviewer.refresh', () => {
			shared.refresh();
			taskTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.launchRefresh', () => {
			shared.asyncTasks = undefined;
			shared.refresh();
			launchTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.run',	(item: Item) => item.run()),
		vscode.commands.registerCommand('taskviewer.edit',	(item: Item) => item.edit()),
		vscode.commands.registerCommand('taskviewer.stop',	(item: Item) => shared.stop(item)),

		vscode.commands.registerCommand('taskviewer.showLaunches',	() => setConfig('showLaunches', true)),
		vscode.commands.registerCommand('taskviewer.hideLaunches',	() => setConfig('showLaunches', false)),

		vscode.commands.registerCommand('taskviewer.showAll',		() => { shared.asyncTasks = undefined; setConfig('showAll', true); }),
		vscode.commands.registerCommand('taskviewer.showConfig',	() => setConfig('showAll', false)),

		vscode.commands.registerCommand('taskviewer.groupByWorkspace',	() => setConfig('groupByWorkspace', true)),
		vscode.commands.registerCommand('taskviewer.ungroupByWorkspace',() => setConfig('groupByWorkspace', false)),

		vscode.tasks.onDidStartTaskProcess(e => {
			if (e.execution.task) {
				shared.startedTask(taskId(e.execution.task), e.execution);
				taskTree.refresh();
				launchTree.refresh();
			}
		}),
		vscode.tasks.onDidEndTaskProcess(e => {
			if (e.execution.task) {
				shared.stoppedTask(taskId(e.execution.task), e.exitCode);
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
		}),
	);

	return shared;
}

//export function deactivate(): void {}
export type exports = ReturnType<typeof activate>;

import * as vscode from 'vscode';
import { TasksShared, TaskTreeProvider, TaskItem } from './tasktree';
import { MakeTaskProvider } from './taskmake';

export let taskProvider: MakeTaskProvider;

export function taskId(task: vscode.Task) {
	return typeof task.scope === 'object' && task.scope?.name ? `${task.scope.name}.${task.name}` : task.name;
}
export function taskWorkspace(task: vscode.Task) {
	return typeof(task.scope) === 'object' ? task.scope
		: task.scope === vscode.TaskScope.Workspace ? vscode.workspace.workspaceFolders?.[0]
		: undefined;
}

//-----------------------------------------------------------------------------
// entry
//-----------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
	// Monkey patch fs.promises.stat to trace calls
	/*
	const originalStat = fs.promises.stat;
	(fs.promises as any).stat = function(path: fs.PathLike) {
		console.log('fs.promises.stat called for:', path);
		console.log('Stack:', new Error().stack);
		return originalStat.call(this, path);
	};

	// Add global unhandled rejection handler
	process.on('unhandledRejection', (reason, promise) => {
		console.error('Unhandled Promise Rejection:', reason);
	});
*/
	taskProvider		= new MakeTaskProvider(context);

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
		vscode.tasks.registerTaskProvider('taskmake', taskProvider),

		vscode.commands.registerCommand('taskviewer.refresh', () => {
			shared.refresh();
			taskTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.launchRefresh', () => {
			shared.refresh();
			launchTree.refresh();
		}),

		vscode.commands.registerCommand('taskviewer.run',	(item: TaskItem) => 
			item.run!()),
		vscode.commands.registerCommand('taskviewer.edit',	(item: TaskItem) => 
			item.edit()),

		vscode.commands.registerCommand('taskviewer.showLaunches',	() => setConfig('showLaunches', true)),
		vscode.commands.registerCommand('taskviewer.hideLaunches',	() => setConfig('showLaunches', false)),

		vscode.commands.registerCommand('taskviewer.showAll',		() => setConfig('showAll', true)),
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

}

//export function deactivate(): void {}

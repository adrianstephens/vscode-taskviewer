# Task List

Provides quick access to your workspace tasks and/or launch scripts from the explorer or debug view.


## Features

- Task view grouped by task group, with color-coded icons
- Optional launch scripts included with tasks
- Separate Launch script view in debug pane, grouped by presentation group
- Task and Launch script execution on click from the explorer view
- Task and Launch script editing (opens in appropriate tasks.json or launch.json)
- Visual status updates for running, successful, or failed tasks (with exit codes)
- Stop button for running tasks or active debug sessions

<style>
@font-face {
	font-family: "codicon";
	src: url("assets/codicon.ttf") format("truetype");
}
red { color: Red }
green { color: Green }
blue { color: Blue }
orange { color: Orange }
purple { color: Purple }
yellow { color: Yellow }
icon { font-family: codicon }
</style>

### Icons
Theme icons are associated with strings found in task or launch script names, and can be customized using the setting taskList.icons. The default associations are:
- clean: 			trash ( <icon>&#xEA81;</icon> )
- build: 			package ( <icon>&#xEB29;</icon> )
- rebuild: 			package ( <icon>&#xEB29;</icon> )
- test: 			beaker ( <icon>&#xEA79;</icon> )
- debug: 			bug ( <icon>&#xEAAF;</icon> )
- launch: 			rocket ( <icon>&#xEB44;</icon> )
- terminal: 		terminal ( <icon>&#xEA85;</icon> )
- watch: 			eye ( <icon>&#xEB7C;</icon> )
- deploy: 			cloud-upload ( <icon>&#xEBAA;</icon> )
- start: 			play ( <icon>&#xEB2C;</icon> )
- stop: 			stop ( <icon>&#xEAD7;</icon> )
- publish: 			cloud ( <icon>&#xEBAA;</icon> )
- default: 			gear ( <icon>&#xEAF8;</icon> )

### Colors
Theme colors are associated with task or launch script types, and can be customized using the setting taskList.colors. The default associations are:
##### Tasks
- npm: 				<red>chart.red</red>
- shell: 			<blue>chart.blue</blue>
- typescript: 	    <purple>chart.purple</purple>
- gulp: 			<orange>chart.orange</orange>
- grunt: 			<yellow>chart.yellow</yellow>
##### Launch scripts
- node: 			<red>chart.red</red>
- extensionHost:    <blue>chart.blue</blue>
- chrome:			<green>chart.green</green>
- msedge:			<purple>chart.purple</purple>
- compound:			<blue>chart.blue</blue>
- default: 			<yellow>chart.yellow</yellow>

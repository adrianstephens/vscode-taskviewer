# TaskMake (with integrated TaskView)

**Make-like incremental builds for VS Code tasks** — run tasks only when their inputs are newer than their outputs, with automatic dependency resolution and variable-based pattern matching.

Tired of rebuilding everything every time?  
TaskMake lets you declare **inputs** and **outputs** for each task, and will only run the task when needed — just like `make`, but natively in VS Code.

## TaskMake Features

- 🛠 **Incremental builds** — skip tasks when outputs are already up-to-date.
- 🔗 **Automatic dependency resolution** — TaskMake finds and runs other tasks to make missing or stale inputs.
- 📁 **Globs & variable substitution** — supports glob patterns (`**/*.cpp`) and VS Code task variables (`${fileBasenameNoExtension}`).
- ⚡ **Fast** — build only what changed.
- 🔄 **Integrates with existing workflows** — run shell commands, processes, or other VS Code tasks.

---

### Example: C++ Incremental Build

Below is an example showing how TaskMake can build two `.o` files from `.cpp` sources and then link them into an executable — only rebuilding what’s out of date.

Key points to note:
- In `outputs`, globs (e.g. `"build/*.o"`) are used for finding tasks that can produce a missing file.
- When a missing input matches an `outputs` glob, TaskMake substitutes the matched filename into `${file…}` variables in that task’s definition before execution.
- `${file…}` variables in `outputs` are **not** used for matching; matching is done on the literal glob pattern.
- Globs in `inputs` are expanded to currently existing files — they won’t cause new files to be created.


## Quick Example

```jsonc
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "compile-cpp",
      "type": "taskmake",
      "inputs": ["src/${fileBasenameNoExtension}.cpp"],
      "outputs": ["build/${fileBasenameNoExtension}.o"],
      "command": "g++",
      "args": ["-c", "${input}", "-o", "${output}"]
    },
    {
      "label": "link",
      "type": "taskmake",
      "inputs": ["build/*.o"],
      "outputs": ["build/app.exe"],
      "command": "g++",
      "args": ["build/*.o", "-o", "build/app.exe"],
      "dependsOn": ["compile-cpp"]
    }
  ]
}
````

When you run `link`:

1. TaskMake checks if `build/app.exe` is older than any `.o` file in `build/`.
2. If an `.o` file is missing or stale, TaskMake finds a task that produces it (`compile-cpp`), patches `${fileBasenameNoExtension}` with the real filename, and runs it.
3. Once all `.o` files are up-to-date, `link` runs.

---

## TaskMake Parameters

Each TaskMake task extends the normal VS Code `TaskDefinition`:

### Execution type — choose **one**

- **`command`** *(string)* — Shell command to run if out-of-date.  
  Example: `"command": "gcc"`  
  **`args`** *(string[])* — Arguments to the command.  
  Example: `"args": ["-c", "src/app.c", "-o", "build/app.o"]`

- **`process`** *(string)* — Run directly as a process (no shell).  
  Example: `"process": "node"`

- **`task`** *(string)* — Run another VS Code task instead of a shell command.  
  Example: `"task": "my-other-task"`

---

### Common properties

| Property       | Type                       | Description |
|----------------|----------------------------|-------------|
| `label`        | string (required)          | The task name. |
| `inputs`       | string[]                   | Files or globs that are the *sources* for this task. Globs expand before timestamp check. Supports VS Code variables. |
| `outputs`      | string[]                   | Files or globs that are the *results* of this task. If missing or older than inputs, task runs. |
| `ignoreErrors` | boolean                    | If true, dependent tasks still run even if this fails. |
| `options.cwd`  | string                     | Working directory. |
| `options.env`  | object                     | Extra environment variables. |
| `dependsOn`    | string[]                   | Labels of other TaskMake tasks to check/run first. |

---

## Dependency Resolution Flow

1. **Check freshness**  
   Compare timestamps for all `inputs` and `outputs`.  
   If all outputs exist and are newer, skip.

2. **Find missing inputs**  
   If an input is stale or missing, search for another TaskMake task whose `outputs` match (including glob patterns).

3. **Variable patching**  
   If matched task outputs contain VS Code variables (like `${fileBasenameNoExtension}`), patch them with the actual file values.

4. **Run recursively**  
   Build dependencies first, then re-check freshness before running the original task.

---

## Why TaskMake instead of make?

- No Makefile syntax to learn.
- Fully integrated into VS Code’s task UI.
- Cross-platform without extra tools installed.
- Plays nice with other VS Code tasks.

---

## License
MIT

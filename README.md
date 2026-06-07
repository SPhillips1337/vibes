# 🌌 Vibes

**Vibes** is a high-performance, autonomous TUI (Terminal User Interface) harness designed for the **Gemma4 26B** model. It empowers you to manage complex missions by breaking them down into actionable milestones and tasks, all within a sleek, interactive terminal environment.

Built with **Ink 5** and **React 18**, Vibes connects to a remote Ollama instance to provide a state-of-the-art agentic experience with hierarchical planning and DAG-based autonomous scheduling.

---

## ✨ Features

- **🎯 Hierarchical Mission Planning**: Automatically break down high-level missions into milestones and actionable tasks using Gemma4's 32K context window.
- **🤖 Autonomous Agent Loop**: Executes individual tasks with a robust loop, supporting tool calls, streaming responses, and reasoning-first thinking.
- **📅 DAG-Based Scheduler**: Manages task dependencies, parallel execution (up to 2 concurrent tasks), and auto-discovery of new tasks during execution.
- **📟 Interactive TUI**: A premium terminal experience featuring:
  - **Dashboard**: High-level progress and statistics.
  - **Mission View**: Tree structure of missions, milestones, and tasks.
  - **Task View**: Live agent output with grouped tool call visualization.
  - **Settings**: Real-time configuration and model switching.
- **🛠️ Integrated Toolset**: Native support for file operations (`read`, `write`, `edit`, `glob`, `grep`), shell command execution, and workspace-wide symbol search.
- **🔌 MCP & Plugin Support**: First-class support for the Model Context Protocol (MCP) with dynamic environment variable expansion in `.vibes/mcp.json`.
- **🛡️ Safety & Reliability**: 
  - **Auto-Git Snapshots**: Automatically commits workspace state before missions start.
  - **Undo Mission (`Alt+Z`)**: Instantly reset the workspace if an agent botches a task.
  - **Thrashing Detection**: Automatically pauses if the agent gets stuck in a tool-call loop.

---

## 🧠 Model Flexibility

While **Vibes** was built to leverage the specific reasoning and tool-calling strengths of **Gemma4**, its underlying architecture is model-agnostic. 

- **OpenAI Compatibility**: Vibes uses the OpenAI SDK to communicate with Ollama, making it compatible with a wide range of models.
- **Thinking/Reasoning**: Supports models that provide a `reasoning` field in their response (like Gemma4 and DeepSeek R1).
- **Tool Calling**: Works with any model that supports standard OpenAI tool call formatting.

To switch models, simply update `OLLAMA_MODEL` and `OLLAMA_BASE_URL` in your `.env` file.

---


### Prerequisites

- **Node.js**: v18.0.0 or higher
- **Ollama**: Access to an Ollama instance. While Vibes is optimized for **Gemma4 26B** (`VladimirGav/gemma4-26b-16GB-VRAM:latest`), it is compatible with any model that supports OpenAI-style tool calling (e.g., Llama 3.1, Mistral, DeepSeek) by simply updating the `.env` configuration.


### 🚀 Quick Install (Linux)

The easiest way to install Vibes and set up the global `vibes` command is using our automated installer:

```bash
curl -fsSL https://raw.githubusercontent.com/SPhillips1337/Vibes/main/install.sh | bash
```

This script will:
- Clone the repository to `~/Vibes`.
- Install dependencies and build the project.
- Add a `vibes` function to your shell configuration (`.bashrc`, `.zshrc`).
- Enable **Automatic Workspace Detection** (Vibes will default to the directory you launched it from).

### 🪟 Quick Install (Windows)

```powershell
irm https://raw.githubusercontent.com/SPhillips1337/Vibes/main/install.ps1 | iex
```

This script will:
- Clone the repository to `$HOME\Vibes`.
- Install dependencies and build the project.
- Add a `vibes` function to your PowerShell `$PROFILE`.
- Enable **Automatic Workspace Detection** (Vibes will default to the directory you launched it from).

---

### Manual Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/SPhillips1337/vibes.git
   cd vibes
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   Create a `.env` file in the root directory:
   ```env
   OLLAMA_BASE_URL=https://your-ollama-endpoint/v1
   OLLAMA_MODEL=VladimirGav/gemma4-26b-16GB-VRAM:latest
   OLLAMA_API_KEY=ollama
   CONTEXT_WINDOW=32768
   ```

---

### Running Vibes

#### npm

Install the published CLI globally:

```bash
npm install --global vibes-tui
vibes
```

Or run it without a global install:

```bash
npx vibes-tui
```

Local JSONL memory works without additional packages. To use the optional
remote Mem0 integration, install it alongside Vibes:

```bash
npm install --global vibes-tui mem0ai
```

#### ⚡ Using the Global Command
If you used the quick installer, you can launch Vibes from **any directory** on your system:

```bash
vibes
```
*Note: Vibes will automatically detect your current path and set it as the workspace root.*

#### 🛠️ Development & Manual Execution
- **Development Mode** (with hot reload):
  ```bash
  npm run dev
  ```

- **Production Build**:
  ```bash
  npm run build
  npm start
  ```

- **Direct Execution**:
  ```bash
  tsx src/index.tsx
  ```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+D` | Switch to **Dashboard** |
| `Alt+M` | Switch to **Missions** view |
| `Alt+T` | Switch to **Tasks** view |
| `Alt+S` | Open **Settings** |
| `Alt+N` | Create a **New Mission** |
| `Alt+Z` | **Undo Mission** (Git hard-reset) |
| `Alt+Y` | Toggle **YOLO Mode** |
| `Alt+X` | **Dismiss** Update Notification |
| `Ctrl+Q` | **Quit** the application |
| `Tab` | Cycle focus between panels |

---

## 🏗️ Architecture

- **`src/index.tsx`**: Entry point and TUI initialization.
- **`src/agent/`**: The brain of Vibes, containing the mission planner, task executor, and autonomous scheduler.
- **`src/tui/`**: React-based terminal components using Ink.
- **`src/tools/`**: A registry of Zod-validated tools for the agent to interact with the system.

---

## 📝 License

This project is licensed under the [MIT License](LICENSE.md).

---

*Built with ❤️ for the Gemma community.*

Test Mission: Create a loading skeleton component with shimmer animation, variant shapes, and Suspense integration
